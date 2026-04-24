import {
  type User,
  type InsertUser,
  type Transaction,
  type Entity,
  type PriorityStackItem,
  type AnalysisJob,
  type Conversation,
  type Message,
  type Goal,
  type StandingInstruction,
  type ActivityEvent,
  type InsertMessage,
  type InsertGoal,
  type InsertStandingInstruction,
  type InsertActivityEvent,
  users,
  transactions,
  entities,
  priorityStackItems,
  analysisJobs,
  conversations,
  messages,
  goals,
  standingInstructions,
  activityEvents,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, asc } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;

  // Transactions
  createTransactions(txs: Omit<Transaction, "id" | "createdAt">[]): Promise<void>;
  getTransactions(userId: string): Promise<Transaction[]>;
  clearTransactions(userId: string): Promise<void>;

  // Entities
  createEntity(entity: Omit<Entity, "id" | "createdAt">): Promise<Entity>;
  getEntities(userId: string): Promise<Entity[]>;
  updateEntity(id: string, updates: Partial<Entity>): Promise<Entity | undefined>;
  clearEntities(userId: string): Promise<void>;

  // Priority stack
  createPriorityStackItem(item: Omit<PriorityStackItem, "id" | "createdAt">): Promise<PriorityStackItem>;
  getPriorityStack(userId: string): Promise<PriorityStackItem[]>;
  clearPriorityStack(userId: string): Promise<void>;
  savePriorityStack(userId: string, items: { rank: number; label: string; monthlyAmount: number; tier: string; category?: string }[]): Promise<void>;

  // Analysis jobs
  createAnalysisJob(userId: string, init?: Partial<AnalysisJob>): Promise<AnalysisJob>;
  getAnalysisJob(id: string): Promise<AnalysisJob | undefined>;
  updateAnalysisJob(id: string, updates: Partial<AnalysisJob>): Promise<void>;

  // Conversations
  getOrCreateConversation(userId: string): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | undefined>;

  // Messages
  createMessage(msg: InsertMessage): Promise<Message>;
  getMessages(conversationId: string): Promise<Message[]>;

  // Goals
  getGoals(userId: string): Promise<Goal[]>;
  createGoal(goal: InsertGoal): Promise<Goal>;
  updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | undefined>;

  // Standing instructions
  getStandingInstructions(userId: string): Promise<StandingInstruction[]>;
  createStandingInstruction(instr: InsertStandingInstruction): Promise<StandingInstruction>;
  updateStandingInstruction(id: string, updates: Partial<StandingInstruction>): Promise<StandingInstruction | undefined>;
  deleteStandingInstruction(id: string): Promise<void>;

  // Activity events
  getActivityEvents(userId: string, kind?: string): Promise<ActivityEvent[]>;
  createActivityEvent(event: InsertActivityEvent): Promise<ActivityEvent>;
}

export class DbStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return user;
  }

  async createTransactions(txs: Omit<Transaction, "id" | "createdAt">[]): Promise<void> {
    if (txs.length === 0) return;
    for (let i = 0; i < txs.length; i += 100) {
      await db.insert(transactions).values(txs.slice(i, i + 100));
    }
  }

  async getTransactions(userId: string): Promise<Transaction[]> {
    return db.select().from(transactions).where(eq(transactions.userId, userId));
  }

  async clearTransactions(userId: string): Promise<void> {
    await db.delete(transactions).where(eq(transactions.userId, userId));
  }

  async createEntity(entity: Omit<Entity, "id" | "createdAt">): Promise<Entity> {
    const [e] = await db.insert(entities).values(entity).returning();
    return e;
  }

  async getEntities(userId: string): Promise<Entity[]> {
    return db.select().from(entities).where(eq(entities.userId, userId));
  }

  async updateEntity(id: string, updates: Partial<Entity>): Promise<Entity | undefined> {
    const [e] = await db.update(entities).set(updates).where(eq(entities.id, id)).returning();
    return e;
  }

  async clearEntities(userId: string): Promise<void> {
    await db.delete(entities).where(eq(entities.userId, userId));
  }

  async createPriorityStackItem(item: Omit<PriorityStackItem, "id" | "createdAt">): Promise<PriorityStackItem> {
    const [i] = await db.insert(priorityStackItems).values(item).returning();
    return i;
  }

  async getPriorityStack(userId: string): Promise<PriorityStackItem[]> {
    return db
      .select()
      .from(priorityStackItems)
      .where(and(eq(priorityStackItems.userId, userId), eq(priorityStackItems.isActive, true)))
      .orderBy(asc(priorityStackItems.rank));
  }

  async clearPriorityStack(userId: string): Promise<void> {
    await db.update(priorityStackItems).set({ isActive: false }).where(eq(priorityStackItems.userId, userId));
  }

  async savePriorityStack(
    userId: string,
    items: { rank: number; label: string; monthlyAmount: number; tier: string; category?: string }[]
  ): Promise<void> {
    await this.clearPriorityStack(userId);
    if (items.length === 0) return;
    await db.insert(priorityStackItems).values(
      items.map((item) => ({
        userId,
        rank: item.rank,
        label: item.label,
        monthlyAmount: item.monthlyAmount,
        tier: item.tier as "1" | "2" | "3" | "4" | "unknown",
        category: item.category || null,
        isActive: true,
      }))
    );
  }

  async createAnalysisJob(userId: string, init: Partial<AnalysisJob> = {}): Promise<AnalysisJob> {
    const [job] = await db.insert(analysisJobs).values({ userId, status: "pending", progress: 0, ...init }).returning();
    return job;
  }

  async getAnalysisJob(id: string): Promise<AnalysisJob | undefined> {
    const [job] = await db.select().from(analysisJobs).where(eq(analysisJobs.id, id));
    return job;
  }

  async updateAnalysisJob(id: string, updates: Partial<AnalysisJob>): Promise<void> {
    await db.update(analysisJobs).set({ ...updates, updatedAt: new Date() }).where(eq(analysisJobs.id, id));
  }

  // ── Conversations ──────────────────────────────────────────────────────────

  async getOrCreateConversation(userId: string): Promise<Conversation> {
    const [existing] = await db.select().from(conversations).where(eq(conversations.userId, userId));
    if (existing) return existing;
    const [created] = await db.insert(conversations).values({ userId }).returning();
    return created;
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conv;
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  async createMessage(msg: InsertMessage): Promise<Message> {
    const [m] = await db.insert(messages).values(msg).returning();
    return m;
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));
  }

  // ── Goals ──────────────────────────────────────────────────────────────────

  async getGoals(userId: string): Promise<Goal[]> {
    return db.select().from(goals).where(eq(goals.userId, userId)).orderBy(asc(goals.createdAt));
  }

  async createGoal(goal: InsertGoal): Promise<Goal> {
    const [g] = await db.insert(goals).values(goal).returning();
    return g;
  }

  async updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | undefined> {
    const [g] = await db.update(goals).set(updates).where(eq(goals.id, id)).returning();
    return g;
  }

  // ── Standing Instructions ──────────────────────────────────────────────────

  async getStandingInstructions(userId: string): Promise<StandingInstruction[]> {
    return db
      .select()
      .from(standingInstructions)
      .where(eq(standingInstructions.userId, userId))
      .orderBy(desc(standingInstructions.createdAt));
  }

  async createStandingInstruction(instr: InsertStandingInstruction): Promise<StandingInstruction> {
    const [i] = await db.insert(standingInstructions).values(instr).returning();
    return i;
  }

  async updateStandingInstruction(id: string, updates: Partial<StandingInstruction>): Promise<StandingInstruction | undefined> {
    const [i] = await db.update(standingInstructions).set(updates).where(eq(standingInstructions.id, id)).returning();
    return i;
  }

  async deleteStandingInstruction(id: string): Promise<void> {
    await db
      .update(standingInstructions)
      .set({ isActive: false, pausedReason: "Removed by user" })
      .where(eq(standingInstructions.id, id));
  }

  // ── Activity Events ────────────────────────────────────────────────────────

  async getActivityEvents(userId: string, kind?: string): Promise<ActivityEvent[]> {
    const base = db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.userId, userId))
      .orderBy(desc(activityEvents.createdAt))
      .limit(200);
    return base;
  }

  async createActivityEvent(event: InsertActivityEvent): Promise<ActivityEvent> {
    const [e] = await db.insert(activityEvents).values(event).returning();
    return e;
  }
}

// In-memory fallback (used if DB not available)
export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private transactionsList: Map<string, Transaction[]> = new Map();
  private entitiesList: Map<string, Entity[]> = new Map();
  private priorityStackList: Map<string, PriorityStackItem[]> = new Map();
  private jobsList: Map<string, AnalysisJob> = new Map();
  private conversationsList: Map<string, Conversation> = new Map();
  private messagesList: Map<string, Message[]> = new Map();
  private goalsList: Map<string, Goal[]> = new Map();
  private instructionsList: Map<string, StandingInstruction[]> = new Map();
  private eventsList: Map<string, ActivityEvent[]> = new Map();

  async getUser(id: string) { return this.users.get(id); }
  async getUserByUsername(username: string) {
    return Array.from(this.users.values()).find((u) => u.username === username);
  }
  async createUser(insertUser: InsertUser): Promise<User> {
    const user: User = {
      id: randomUUID(),
      username: insertUser.username,
      password: insertUser.password,
      displayName: insertUser.displayName ?? null,
      onboardingStage: "upload",
      onboardingJobId: null,
      safeBuffer: 2000,
      financialHealthScore: null,
      estimatedBalance: null,
      emergencyBrakeActive: false,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }
  async updateUser(id: string, updates: Partial<User>) {
    const user = this.users.get(id);
    if (!user) return undefined;
    const updated = { ...user, ...updates };
    this.users.set(id, updated);
    return updated;
  }
  async createTransactions(txs: Omit<Transaction, "id" | "createdAt">[]): Promise<void> {
    for (const tx of txs) {
      const userId = tx.userId;
      if (!this.transactionsList.has(userId)) this.transactionsList.set(userId, []);
      this.transactionsList.get(userId)!.push({ ...tx, id: randomUUID(), createdAt: new Date() });
    }
  }
  async getTransactions(userId: string) { return this.transactionsList.get(userId) || []; }
  async clearTransactions(userId: string) { this.transactionsList.delete(userId); }
  async createEntity(entity: Omit<Entity, "id" | "createdAt">): Promise<Entity> {
    const e: Entity = { ...entity, id: randomUUID(), createdAt: new Date() };
    if (!this.entitiesList.has(entity.userId)) this.entitiesList.set(entity.userId, []);
    this.entitiesList.get(entity.userId)!.push(e);
    return e;
  }
  async getEntities(userId: string) { return this.entitiesList.get(userId) || []; }
  async updateEntity(id: string, updates: Partial<Entity>) {
    for (const [, list] of this.entitiesList.entries()) {
      const idx = list.findIndex((e) => e.id === id);
      if (idx >= 0) { list[idx] = { ...list[idx], ...updates }; return list[idx]; }
    }
    return undefined;
  }
  async clearEntities(userId: string) { this.entitiesList.delete(userId); }
  async createPriorityStackItem(item: Omit<PriorityStackItem, "id" | "createdAt">): Promise<PriorityStackItem> {
    const i: PriorityStackItem = { ...item, id: randomUUID(), createdAt: new Date() };
    if (!this.priorityStackList.has(item.userId)) this.priorityStackList.set(item.userId, []);
    this.priorityStackList.get(item.userId)!.push(i);
    return i;
  }
  async getPriorityStack(userId: string) {
    return (this.priorityStackList.get(userId) || []).filter((i) => i.isActive).sort((a, b) => a.rank - b.rank);
  }
  async clearPriorityStack(userId: string) {
    (this.priorityStackList.get(userId) || []).forEach((i) => (i.isActive = false));
  }
  async savePriorityStack(userId: string, items: { rank: number; label: string; monthlyAmount: number; tier: string; category?: string }[]) {
    await this.clearPriorityStack(userId);
    for (const item of items) {
      await this.createPriorityStackItem({
        userId, rank: item.rank, label: item.label, monthlyAmount: item.monthlyAmount,
        tier: item.tier as "1" | "2" | "3" | "4" | "unknown",
        category: item.category || null, entityId: null, isActive: true,
      });
    }
  }
  async createAnalysisJob(userId: string, init: Partial<AnalysisJob> = {}): Promise<AnalysisJob> {
    const job: AnalysisJob = {
      id: randomUUID(), userId, status: "pending", progress: 0, progressLabel: "Starting...",
      transactionCount: null, unknownCount: null, revealMessage: null, summaryData: null,
      attachedSources: [], smsText: null, annotation: null, error: null,
      createdAt: new Date(), updatedAt: new Date(), ...init,
    };
    this.jobsList.set(job.id, job);
    return job;
  }
  async getAnalysisJob(id: string) { return this.jobsList.get(id); }
  async updateAnalysisJob(id: string, updates: Partial<AnalysisJob>) {
    const job = this.jobsList.get(id);
    if (job) this.jobsList.set(id, { ...job, ...updates, updatedAt: new Date() });
  }

  async getOrCreateConversation(userId: string): Promise<Conversation> {
    let conv = this.conversationsList.get(userId);
    if (!conv) {
      conv = { id: randomUUID(), userId, createdAt: new Date(), updatedAt: new Date() };
      this.conversationsList.set(userId, conv);
    }
    return conv;
  }
  async getConversation(id: string): Promise<Conversation | undefined> {
    return Array.from(this.conversationsList.values()).find((c) => c.id === id);
  }
  async createMessage(msg: InsertMessage): Promise<Message> {
    const m: Message = { ...msg, id: randomUUID(), createdAt: new Date(), toolCallsJson: msg.toolCallsJson ?? null };
    if (!this.messagesList.has(msg.conversationId)) this.messagesList.set(msg.conversationId, []);
    this.messagesList.get(msg.conversationId)!.push(m);
    return m;
  }
  async getMessages(conversationId: string): Promise<Message[]> {
    return (this.messagesList.get(conversationId) || []).sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime());
  }
  async getGoals(userId: string): Promise<Goal[]> { return this.goalsList.get(userId) || []; }
  async createGoal(goal: InsertGoal): Promise<Goal> {
    const g: Goal = { ...goal, id: randomUUID(), createdAt: new Date(), currentAmount: goal.currentAmount ?? 0, weeklyContribution: goal.weeklyContribution ?? 0, deadline: goal.deadline ?? null, status: goal.status ?? "on_track" };
    if (!this.goalsList.has(goal.userId)) this.goalsList.set(goal.userId, []);
    this.goalsList.get(goal.userId)!.push(g);
    return g;
  }
  async updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | undefined> {
    for (const [, list] of this.goalsList.entries()) {
      const idx = list.findIndex((g) => g.id === id);
      if (idx >= 0) { list[idx] = { ...list[idx], ...updates }; return list[idx]; }
    }
    return undefined;
  }
  async getStandingInstructions(userId: string): Promise<StandingInstruction[]> {
    return (this.instructionsList.get(userId) || []).sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime());
  }
  async createStandingInstruction(instr: InsertStandingInstruction): Promise<StandingInstruction> {
    const i: StandingInstruction = { ...instr, id: randomUUID(), createdAt: new Date(), isActive: instr.isActive ?? true, lastFiredAt: instr.lastFiredAt ?? null, pausedReason: instr.pausedReason ?? null, logicType: instr.logicType ?? "recurring" };
    if (!this.instructionsList.has(instr.userId)) this.instructionsList.set(instr.userId, []);
    this.instructionsList.get(instr.userId)!.push(i);
    return i;
  }
  async updateStandingInstruction(id: string, updates: Partial<StandingInstruction>): Promise<StandingInstruction | undefined> {
    for (const [, list] of this.instructionsList.entries()) {
      const idx = list.findIndex((i) => i.id === id);
      if (idx >= 0) { list[idx] = { ...list[idx], ...updates }; return list[idx]; }
    }
    return undefined;
  }
  async deleteStandingInstruction(id: string): Promise<void> {
    await this.updateStandingInstruction(id, { isActive: false, pausedReason: "Removed by user" });
  }
  async getActivityEvents(userId: string): Promise<ActivityEvent[]> {
    return (this.eventsList.get(userId) || []).sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime());
  }
  async createActivityEvent(event: InsertActivityEvent): Promise<ActivityEvent> {
    const e: ActivityEvent = { ...event, id: randomUUID(), createdAt: new Date(), amount: event.amount ?? null };
    if (!this.eventsList.has(event.userId)) this.eventsList.set(event.userId, []);
    this.eventsList.get(event.userId)!.push(e);
    return e;
  }
}

// Use DB storage
export const storage = new DbStorage();
