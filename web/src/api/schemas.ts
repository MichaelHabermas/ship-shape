// API schema aliases expose generated OpenAPI component types to the web client.
import type { components } from './generated/ship-openapi';

export type { ApiError, ApiResponse } from '@ship/shared';

export type Document = components['schemas']['Document'];
export type Standup = components['schemas']['Standup'];
export type UpdatedStandup = components['schemas']['UpdatedStandup'];
export type StandupStatus = components['schemas']['StandupStatus'];
export type MentionSearchResult = components['schemas']['MentionSearchResult'];
export type DocumentSearchResponse = components['schemas']['DocumentSearchResponse'];

export type IssueListItem = components['schemas']['IssueListItem'];
export type Issue = components['schemas']['Issue'];
export type BulkUpdatedIssue = components['schemas']['BulkUpdatedIssue'];
export type BulkUpdateIssuesResponse = components['schemas']['BulkUpdateIssuesResponse'];
export type Project = components['schemas']['Project'];
export type ProjectIssueListItem = components['schemas']['ProjectIssueListItem'];
export type ProjectWeekListItem = components['schemas']['ProjectWeekListItem'];
export type Program = components['schemas']['Program'];
export type UserReference = components['schemas']['UserReference'];
export type BelongsToResponse = components['schemas']['BelongsToResponse'];
export type Week = components['schemas']['Week'];
export type ProgramSprintListItem = components['schemas']['ProgramSprintListItem'];
export type ProgramSprintsResponse = components['schemas']['ProgramSprintsResponse'];
export type ActiveWeekItem = components['schemas']['ActiveWeekItem'];
export type ActiveWeeksResponse = components['schemas']['ActiveWeeksResponse'];

export type FleetGraphEvidence = components['schemas']['FleetGraphEvidence'];
export type FleetGraphRecommendedAction = components['schemas']['FleetGraphRecommendedAction'];
export type FleetGraphVisibleOutput = components['schemas']['FleetGraphVisibleOutput'];
export type FleetGraphTrace = components['schemas']['FleetGraphTrace'];
export type FleetGraphChangeSummaryRow = components['schemas']['FleetGraphChangeSummaryRow'];
export type FleetGraphChangeSummaryResponse = components['schemas']['FleetGraphChangeSummaryResponse'];
export type FleetGraphChatContext = components['schemas']['FleetGraphChatContext'];
export type FleetGraphChatAnswer = components['schemas']['FleetGraphChatAnswer'];
export type FleetGraphChatRequest = components['schemas']['FleetGraphChatRequest'];
export type FleetGraphChatResponse = components['schemas']['FleetGraphChatResponse'];
export type FleetGraphFindingResponse = components['schemas']['FleetGraphFindingResponse'];
export type FleetGraphNotificationResponse = components['schemas']['FleetGraphNotificationResponse'];
export type FleetGraphNotificationsListResponse = components['schemas']['FleetGraphNotificationsListResponse'];
export type FleetGraphRunResponse = components['schemas']['FleetGraphRunResponse'];

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
