import { Client } from "@elastic/elasticsearch";

const node = process.env.ELASTICSEARCH_URL ?? "http://localhost:9200";
export const EMAIL_INDEX = process.env.ELASTICSEARCH_INDEX ?? "reachinbox-emails";

export interface EmailSearchDocument {
  emailId: string;
  campaignId: string;
  userId: string;
  senderId: string;
  recipient: string;
  subject: string;
  status: string;
  scheduledAt: string;
  sentAt?: string | null;
  sequence: number;
}

export const elasticsearch = new Client({ node });

export async function ensureEmailIndex(): Promise<void> {
  try {
    const exists = await elasticsearch.indices.exists({ index: EMAIL_INDEX });
    if (!exists) {
      await elasticsearch.indices.create({
        index: EMAIL_INDEX,
        mappings: {
          properties: {
            emailId: { type: "keyword" },
            campaignId: { type: "keyword" },
            userId: { type: "keyword" },
            senderId: { type: "keyword" },
            recipient: { type: "text", fields: { keyword: { type: "keyword" } } },
            subject: { type: "text" },
            status: { type: "keyword" },
            scheduledAt: { type: "date" },
            sentAt: { type: "date" },
            sequence: { type: "integer" },
          },
        },
      });
    }
  } catch (error) {
    console.error("Elasticsearch startup warning:", error instanceof Error ? error.message : error);
  }
}

export async function indexEmail(document: EmailSearchDocument): Promise<void> {
  try {
    await elasticsearch.index({
      index: EMAIL_INDEX,
      id: document.emailId,
      document,
      refresh: "wait_for",
    });
  } catch (error) {
    console.error("Elasticsearch indexing warning:", error instanceof Error ? error.message : error);
  }
}

export async function searchEmails(userId: string, query: string, page: number, pageSize: number) {
  try {
    const from = (page - 1) * pageSize;
    const response = await elasticsearch.search<EmailSearchDocument>({
      index: EMAIL_INDEX,
      from,
      size: pageSize,
      query: query.trim()
        ? {
            bool: {
              must: [
                {
                  multi_match: {
                    query: query.trim(),
                    fields: ["recipient^3", "subject^2", "status", "campaignId"],
                    type: "best_fields",
                    fuzziness: "AUTO",
                  },
                },
              ],
              filter: [{ term: { userId } }],
            },
          }
        : { bool: { filter: [{ term: { userId } }] } },
      sort: [{ scheduledAt: { order: "desc" } }],
    });

    return {
      total: typeof response.hits.total === "number" ? response.hits.total : response.hits.total?.value ?? 0,
      results: response.hits.hits.map((hit) => hit._source).filter((item): item is EmailSearchDocument => Boolean(item)),
      available: true,
    };
  } catch (error) {
    console.error("Elasticsearch search warning:", error instanceof Error ? error.message : error);
    return { total: 0, results: [], available: false };
  }
}
