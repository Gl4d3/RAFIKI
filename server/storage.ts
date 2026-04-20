import {
  type User,
  type InsertUser,
  type Transaction,
  type Entity,
  type PriorityStackItem,
  type AnalysisJob,
  users,
  transactions,
  entities,
  priorityStackItems,
  analysisJobs,
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
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
  savePriorityStack(userId: string, items: { rank: number; label: string; monthlyAmount: number; tier: string }[]): Promise<void>;

  // Analysis jobs
  createAnalysisJob(userId: string): Promise<AnalysisJob>;
  getAnalysisJob(id: string): Promise<AnalysisJob | undefined>;
  updateAnalysisJob(id: string, updates: Partial<AnalysisJob>): Promise<void>;
}

export class DbStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async createTransactions(
    txs: Omit<Transaction, "id" | "createdAt">[]
  ): Promise<void> {
    if (txs.length === 0) return;
    // Insert in batches of 100
    for (let i = 0; i < txs.length; i += 100) {
      await db.insert(transactions).values(txs.slice(i, i + 100));
    }
  }

  async getTransactions(userId: string): Promise<Transaction[]> {
    return db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId));
  }

  async clearTransactions(userId: string): Promise<void> {
    await db.delete(transactions).where(eq(transactions.userId, userId));
  }

  async createEntity(
    entity: Omit<Entity, "id" | "createdAt">
  ): Promise<Entity> {
    const [e] = await db.insert(entities).values(entity).returning();
    return e;
  }

  async getEntities(userId: string): Promise<Entity[]> {
    return db.select().from(entities).where(eq(entities.userId, userId));
  }

  async updateEntity(
    id: string,
    updates: Partial<Entity>
  ): Promise<Entity | undefined> {
    const [e] = await db
      .update(entities)
      .set(updates)
      .where(eq(entities.id, id))
      .returning();
    return e;
  }

  async clearEntities(userId: string): Promise<void> {
    await db.delete(entities).where(eq(entities.userId, userId));
  }

  async createPriorityStackItem(
    item: Omit<PriorityStackItem, "id" | "createdAt">
  ): Promise<PriorityStackItem> {
    const [i] = await db.insert(priorityStackItems).values(item).returning();
    return i;
  }

  async getPriorityStack(userId: string): Promise<PriorityStackItem[]> {
    return db
      .select()
      .from(priorityStackItems)
      .where(
        and(eq(priorityStackItems.userId, userId), eq(priorityStackItems.isActive, true))
      );
  }

  async clearPriorityStack(userId: string): Promise<void> {
    await db
      .update(priorityStackItems)
      .set({ isActive: false })
      .where(eq(priorityStackItems.userId, userId));
  }

  async savePriorityStack(
    userId: string,
    items: { rank: number; label: string; monthlyAmount: number; tier: string }[]
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
        isActive: true,
      }))
    );
  }

  async createAnalysisJob(userId: string): Promise<AnalysisJob> {
    const [job] = await db
      .insert(analysisJobs)
      .values({ userId, status: "pending", progress: 0 })
      .returning();
    return job;
  }

  async getAnalysisJob(id: string): Promise<AnalysisJob | undefined> {
    const [job] = await db
      .select()
      .from(analysisJobs)
      .where(eq(analysisJobs.id, id));
    return job;
  }

  async updateAnalysisJob(
    id: string,
    updates: Partial<AnalysisJob>
  ): Promise<void> {
    await db
      .update(analysisJobs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(analysisJobs.id, id));
  }
}

// In-memory fallback (used if DB not available)
export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private transactionsList: Map<string, Transaction[]> = new Map();
  private entitiesList: Map<string, Entity[]> = new Map();
  private priorityStackList: Map<string, PriorityStackItem[]> = new Map();
  private jobsList: Map<string, AnalysisJob> = new Map();

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
    for (const [userId, list] of this.entitiesList.entries()) {
      const idx = list.findIndex((e) => e.id === id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...updates };
        return list[idx];
      }
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
    return (this.priorityStackList.get(userId) || []).filter((i) => i.isActive);
  }
  async clearPriorityStack(userId: string) {
    const list = this.priorityStackList.get(userId) || [];
    list.forEach((i) => (i.isActive = false));
  }
  async savePriorityStack(userId: string, items: { rank: number; label: string; monthlyAmount: number; tier: string }[]) {
    await this.clearPriorityStack(userId);
    for (const item of items) {
      await this.createPriorityStackItem({
        userId,
        rank: item.rank,
        label: item.label,
        monthlyAmount: item.monthlyAmount,
        tier: item.tier as "1" | "2" | "3" | "4" | "unknown",
        entityId: null,
        isActive: true,
      });
    }
  }
  async createAnalysisJob(userId: string): Promise<AnalysisJob> {
    const job: AnalysisJob = {
      id: randomUUID(),
      userId,
      status: "pending",
      progress: 0,
      progressLabel: "Starting...",
      transactionCount: null,
      unknownCount: null,
      revealMessage: null,
      summaryData: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.jobsList.set(job.id, job);
    return job;
  }
  async getAnalysisJob(id: string) { return this.jobsList.get(id); }
  async updateAnalysisJob(id: string, updates: Partial<AnalysisJob>) {
    const job = this.jobsList.get(id);
    if (job) this.jobsList.set(id, { ...job, ...updates, updatedAt: new Date() });
  }
}

// Use DB storage in production, mem storage as fallback
let storageInstance: IStorage;

export function getStorage(): IStorage {
  if (!storageInstance) {
    try {
      storageInstance = new DbStorage();
    } catch {
      console.warn("DB not available, using in-memory storage");
      storageInstance = new MemStorage();
    }
  }
  return storageInstance;
}

export const storage = new DbStorage();
