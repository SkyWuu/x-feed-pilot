import type { ActionPlan, FollowUpTarget, Judgments, ObservedPost, Phase, Session } from '../shared/types.js';

export const LIMITS = {
  durationMs: 10 * 60_000,
  uniquePosts: 80,
  initialMs: 2 * 60_000,
  initialPosts: 10,
  searchMs: 2 * 60_000,
  searchPosts: 20,
  returnPosts: 20,
  maxLikes: 8,
  maxBookmarks: 4,
} as const;

export function newSession(id: string, preference: string, preferenceHash: string, now: number): Session {
  return {
    id, status: 'active', phase: 'for_you', startedAt: now, phaseStartedAt: now,
    preference, preferenceHash, queryIndex: 0, uniqueCount: 0,
    forYouCount: 0, forYouSelected: 0, forYouWindow: [], searchCount: 0,
    returnCount: 0, returnSelected: 0, returnWindow: [], likes: 0, bookmarks: 0,
    authorVisits: 0, jevFailures: 0,
  };
}

export function stopSession(session: Session, reason: string): Session {
  return { ...session, status: 'stopped', phase: 'stopped', stopReason: reason };
}

export function advanceSession(session: Session, now: number): Session {
  if (session.status !== 'active') return session;
  if (now - session.startedAt >= LIMITS.durationMs) return stopSession(session, 'time_limit');
  if (session.uniqueCount >= LIMITS.uniquePosts) return stopSession(session, 'post_limit');
  if (session.jevFailures >= 3) return stopSession(session, 'jev_unavailable');
  if (session.phase === 'for_you' &&
      now - session.phaseStartedAt >= LIMITS.initialMs &&
      session.forYouCount >= LIMITS.initialPosts &&
      ((session.forYouCount <= 20 && session.forYouSelected <= 1) ||
       (session.forYouWindow.length >= 20 && session.forYouWindow.filter(Boolean).length <= 1))) {
    return { ...session, phase: 'search', phaseStartedAt: now, queryIndex: 0 };
  }
  if (session.phase === 'search' &&
      (now - session.phaseStartedAt >= LIMITS.searchMs || session.searchCount >= LIMITS.searchPosts)) {
    return { ...session, phase: 'return', phaseStartedAt: now };
  }
  if (session.phase === 'return' &&
      session.returnCount >= LIMITS.returnPosts &&
      session.returnWindow.length >= 20 && session.returnWindow.filter(Boolean).length <= 1) {
    return stopSession(session, 'low_relevance');
  }
  return session;
}

export function searchQuery(session: Session, seeds: string[], now: number): string | undefined {
  if (session.phase !== 'search' || !seeds.length) return undefined;
  const slot = Math.min(3, Math.floor((now - session.phaseStartedAt) / 30_000));
  return seeds[slot % seeds.length];
}

export function dwellMs(text: string): number {
  return Math.min(30_000, Math.max(3_000, Math.round(3_000 + text.length * 1_000 / 18)));
}

export function actionPlan(
  post: ObservedPost,
  judgments: Judgments | null,
  session: Session,
  already: { liked: boolean; bookmarked: boolean },
  nextVisit?: FollowUpTarget,
  followUpText = '',
): ActionPlan {
  const evidence = `${post.text} ${post.ocrText || ''} ${followUpText}`.trim();
  const insufficient = (evidence.length < 8 && !nextVisit) || judgments === null;
  const excluded = !insufficient && judgments!.excluded >= 0.75;
  const selected = !post.promoted && !insufficient && !excluded && judgments!.interest >= 0.70;
  const label = insufficient ? 'insufficient' : selected ? 'selected' : 'ignored';
  const happens = (probability: number): boolean => Math.random() < probability;
  return {
    label,
    dwellMs: nextVisit ? 0 : dwellMs(evidence),
    openPost: !nextVisit && selected && happens(judgments!.interest),
    visitAuthor: !nextVisit && selected && session.authorVisits < Math.floor(session.uniqueCount / 10) + 1 && happens(judgments!.exploreAuthor),
    like: !nextVisit && selected && session.likes < LIMITS.maxLikes && !already.liked && happens(judgments!.like),
    bookmark: !nextVisit && selected && session.bookmarks < LIMITS.maxBookmarks && !already.bookmarked && happens(judgments!.bookmark),
    ...(nextVisit ? { nextVisit } : {}),
    phase: session.phase,
  };
}

export function countObservation(session: Session, label: ActionPlan['label'], isNewPost: boolean, isNewInPhase: boolean, observedPhase: Phase = session.phase): Session {
  const next = { ...session, uniqueCount: session.uniqueCount + (isNewPost ? 1 : 0) };
  if (!isNewInPhase) return next;
  if (observedPhase === 'for_you') {
    next.forYouCount++;
    if (label === 'selected') next.forYouSelected++;
    next.forYouWindow = [...session.forYouWindow, label === 'selected'].slice(-20);
  } else if (observedPhase === 'search') {
    next.searchCount++;
  } else if (observedPhase === 'return') {
    next.returnCount++;
    if (label === 'selected') next.returnSelected++;
    next.returnWindow = [...session.returnWindow, label === 'selected'].slice(-20);
  }
  return next;
}

export function sourceForPhase(phase: Phase): ObservedPost['source'] {
  return phase === 'search' ? 'search' : 'for_you';
}
