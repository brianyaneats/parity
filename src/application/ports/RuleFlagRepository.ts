export interface RuleFlagRecord {
  readonly id: string;
  readonly userId: string;
  readonly ruleKey: string;
  readonly note: string | null;
  readonly createdAt: Date;
}

export interface NewRuleFlagInput {
  readonly userId: string;
  readonly ruleKey: string;
  readonly note?: string | null;
}

/** `RuleFlagRepository` — port over `rule_flags` (§4.2, §2.8's "flag as changed" button). */
export interface RuleFlagRepository {
  create(input: NewRuleFlagInput): Promise<RuleFlagRecord>;
  listByUser(userId: string): Promise<readonly RuleFlagRecord[]>;
}
