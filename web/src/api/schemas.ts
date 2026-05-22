import type { components } from './generated/ship-openapi';

export type Document = components['schemas']['Document'];
export type Standup = components['schemas']['Standup'];
export type UpdatedStandup = components['schemas']['UpdatedStandup'];
export type StandupStatus = components['schemas']['StandupStatus'];
export type MentionSearchResult = components['schemas']['MentionSearchResult'];
export type DocumentSearchResponse = components['schemas']['DocumentSearchResponse'];

export interface SetupStatusData {
  needsSetup: boolean;
}

export interface AuthProviderStatusData {
  available: boolean;
}

export interface AuthProviderLoginData {
  authorizationUrl: string;
}

export interface AiStatusResponse {
  available: boolean;
  error?: string;
}

export interface CsrfTokenResponse {
  token: string;
}

export interface LegacyErrorResponse {
  error?: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
