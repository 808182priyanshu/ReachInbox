export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface Sender {
  id: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  isActive: boolean;
  createdAt: string;
}

export interface EmailItem {
  id: string;
  recipient: string;
  subject: string;
  scheduledAt?: string;
  sentAt?: string | null;
  status: "SCHEDULED" | "PROCESSING" | "SENT" | "FAILED";
  failureReason?: string | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
