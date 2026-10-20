/**
 * Status grouping for the applicants status filter.
 *
 * The BambooHR status list is flat, but for the filter dropdown we want to
 * organize statuses into meaningful buckets. This module owns that mapping.
 *
 * To edit the grouping, adjust STATUS_GROUP_DEFINITIONS below. Statuses are
 * matched by their exact label; any status whose label is not listed falls
 * into the "Other" group at the bottom.
 */

export type StatusGroupName = 'To Review' | 'Chosen' | 'Rejected' | 'Other';

/**
 * Ordered group -> exact status labels mapping.
 *
 * Order here drives the display order of the groups in the dropdown. "Other"
 * is intentionally not defined explicitly; it is the fallback bucket and is
 * always rendered last.
 */
export const STATUS_GROUP_DEFINITIONS: Record<
  Exclude<StatusGroupName, 'Other'>,
  string[]
> = {
  'To Review': ['New', 'Reviewed', 'Bench'],
  Chosen: [
    'P&C to Schedule Preliminary Screening Interview',
    'Phone Screen Scheduled',
    'Phone Screened',
    'P&C to Request Work Samples',
    'Take Home Test Sent',
    'P&C to Schedule Technical Interview',
    'Technical Interview Scheduled',
    'P&C to Schedule Hiring Manager Interview',
    'Hiring Manager Interview Scheduled',
    'Hiring Manager to Review Feedback',
    'P&C to Schedule Final Interview',
    'Final Interview Scheduled',
    'Final Interview Complete',
    'P&C to Schedule In-Person Colombia Interview',
    'Awaiting Feedback from Interviewer',
    'On Hold - Interviews Complete',
    'Background Check in Progress',
    'Checking References',
    'Offer Out',
    'Recommended for Hire',
    'Hired',
  ],
  Rejected: [
    'Not a Fit',
    'P&C to Reject',
    'Wrong Geographical Location',
    'Lacking Skill(s)/Qualification(s)',
    'Over Qualified',
    'Duplicate',
    'Never Replied',
    'Removed themselves from process',
    'Accepted another Role',
  ],
};

/**
 * Display order for the groups, including the "Other" fallback last.
 */
export const STATUS_GROUP_ORDER: StatusGroupName[] = [
  'To Review',
  'Chosen',
  'Rejected',
  'Other',
];

/**
 * Reverse lookup: exact status label -> group name. Built once from the
 * definitions above so the per-status classification is O(1).
 */
const LABEL_TO_GROUP: Record<string, StatusGroupName> = Object.entries(
  STATUS_GROUP_DEFINITIONS
).reduce<Record<string, StatusGroupName>>((accumulator, [group, labels]) => {
  labels.forEach((label) => {
    accumulator[label] = group as StatusGroupName;
  });
  return accumulator;
}, {});

/**
 * Resolve the group a status label belongs to. Unmapped labels fall into
 * "Other".
 */
export function getGroupForLabel(label: string): StatusGroupName {
  return LABEL_TO_GROUP[label] ?? 'Other';
}

interface StatusLike {
  id: number;
  label: string;
}

export interface StatusGroup<TStatus extends StatusLike> {
  name: StatusGroupName;
  statuses: TStatus[];
}

/**
 * Partition a flat list of statuses into ordered groups. Groups with no
 * matching statuses are omitted so the dropdown never shows an empty header.
 * Within each group, statuses keep the order they arrived in.
 */
export function groupStatuses<TStatus extends StatusLike>(
  statuses: TStatus[]
): StatusGroup<TStatus>[] {
  const buckets = new Map<StatusGroupName, TStatus[]>();

  for (const status of statuses) {
    const group = getGroupForLabel(status.label);
    const existing = buckets.get(group);
    if (existing) {
      existing.push(status);
    } else {
      buckets.set(group, [status]);
    }
  }

  return STATUS_GROUP_ORDER.filter((name) => buckets.has(name)).map((name) => ({
    name,
    statuses: buckets.get(name) ?? [],
  }));
}
