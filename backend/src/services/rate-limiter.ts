import { redisConnection } from "../config/redis.js";

const HOUR_MS = 60 * 60 * 1000;

export interface ReservedSlot {
    sequence: number;
    scheduledAt: number;
}

export interface RateLimitReservation {
    slots: ReservedSlot[];
    limitHitWindows: number[];
}

const RESERVE_SLOTS_SCRIPT = `
local nextKey = KEYS[1]
local prefix = ARGV[1]
local startAt = tonumber(ARGV[2])
local delayMs = tonumber(ARGV[3])
local hourlyLimit = tonumber(ARGV[4])
local count = tonumber(ARGV[5])
local hourMs = 3600000

local storedNext = tonumber(redis.call("GET", nextKey) or "0")
local cursor = math.max(startAt, storedNext)

local result = {}
local hitWindows = {}
local seenWindows = {}

for i = 0, count - 1 do
    local windowStart = math.floor(cursor / hourMs) * hourMs
    local countKey = prefix .. ":" .. tostring(windowStart)
    local currentCount = tonumber(redis.call("GET", countKey) or "0")

    if currentCount >= hourlyLimit then
        cursor = windowStart + hourMs
        windowStart = math.floor(cursor / hourMs) * hourMs
        countKey = prefix .. ":" .. tostring(windowStart)
        currentCount = tonumber(redis.call("GET", countKey) or "0")
    end

    redis.call("INCR", countKey)
    redis.call("EXPIRE", countKey, 172800)

    local newCount = currentCount + 1

    if newCount == hourlyLimit then
        if not seenWindows[tostring(windowStart)] then
            table.insert(hitWindows, windowStart)
            seenWindows[tostring(windowStart)] = true
        end
    end

    table.insert(result, i)
    table.insert(result, cursor)

    cursor = cursor + delayMs
end

redis.call("SET", nextKey, tostring(cursor))

local output = {}
table.insert(output, #hitWindows)

for _, window in ipairs(hitWindows) do
    table.insert(output, window)
end

table.insert(output, #result)

for _, value in ipairs(result) do
    table.insert(output, value)
end

return output
`;

export async function reserveSendSlots(params: {
    senderId: string;
    startAt: Date;
    count: number;
    delayMs: number;
    hourlyLimit: number;
}): Promise<RateLimitReservation> {
    if (params.count <= 0) {
        return {
            slots: [],
            limitHitWindows: [],
        };
    }

    if (params.delayMs < 0) {
        throw new Error("delayMs cannot be negative");
    }

    if (params.hourlyLimit <= 0) {
        throw new Error("hourlyLimit must be greater than zero");
    }

    const nextKey = `scheduler:sender:${params.senderId}:next`;
    const countPrefix = `scheduler:sender:${params.senderId}:hour`;

    const raw = (await redisConnection.eval(
        RESERVE_SLOTS_SCRIPT,
        1,
        nextKey,
        countPrefix,
        params.startAt.getTime().toString(),
        params.delayMs.toString(),
        params.hourlyLimit.toString(),
        params.count.toString(),
    )) as number[];

    let index = 0;

    const hitWindowCount = Number(raw[index++]);
    const limitHitWindows: number[] = [];

    for (let i = 0; i < hitWindowCount; i++) {
        limitHitWindows.push(Number(raw[index++]));
    }

    const resultCount = Number(raw[index++]);
    const slots: ReservedSlot[] = [];

    for (let i = 0; i < resultCount; i += 2) {
        slots.push({
            sequence: Number(raw[index++]),
            scheduledAt: Number(raw[index++]),
        });
    }

    return {
        slots,
        limitHitWindows,
    };
}