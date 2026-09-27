export type Source = 'for_you' | 'search';
export type Label = 'selected' | 'ignored' | 'insufficient';
export type Phase = 'for_you' | 'search' | 'return' | 'stopped';

export interface ImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ObservedPost {
  postId: string;
  url: string;
  author: string;
  text: string;
  source: Source;
  query?: string;
  imageRects: ImageRect[];
  viewportWidth: number;
  viewportHeight: number;
  hasVideo: boolean;
  promoted: boolean;
  links?: { url: string; text: string }[];
  mentions?: { handle: string; url: string }[];
  screenshot?: string;
  ocrText?: string;
}

export interface FollowUpTarget {
  kind: 'link' | 'mention';
  url: string;
}

export interface FollowUpEvidence extends FollowUpTarget {
  finalUrl: string;
  text: string;
  success: boolean;
}

export interface Judgments {
  interest: number;
  like: number;
  bookmark: number;
  exploreAuthor: number;
  excluded: number;
}

export interface ActionPlan {
  label: Label;
  dwellMs: number;
  openPost: boolean;
  visitAuthor: boolean;
  like: boolean;
  bookmark: boolean;
  nextVisit?: FollowUpTarget;
  phase: Phase;
  query?: string;
  stopReason?: string;
}

export interface Session {
  id: string;
  status: 'active' | 'stopped';
  phase: Phase;
  startedAt: number;
  phaseStartedAt: number;
  preference: string;
  preferenceHash: string;
  queryIndex: number;
  uniqueCount: number;
  forYouCount: number;
  forYouSelected: number;
  forYouWindow: boolean[];
  searchCount: number;
  returnCount: number;
  returnSelected: number;
  returnWindow: boolean[];
  likes: number;
  bookmarks: number;
  authorVisits: number;
  jevFailures: number;
  stopReason?: string;
}
