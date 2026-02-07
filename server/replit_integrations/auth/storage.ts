import { users } from "@shared/schema";
import type { User } from "@shared/schema";
import { db } from "../../db";
import { eq } from "drizzle-orm";

export type UpsertUser = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
};

// Interface for auth storage operations
// (IMPORTANT) These user operations are mandatory for Replit Auth.
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // A1 is admin-only: All Replit Auth users are admins
    // Customer authentication happens on A5 (students) and A6 (providers) via Clerk
    const role = 'admin';
    
    console.log(`[Auth] Upserting Replit Auth user: ${userData.email}, role: ${role}`);
    
    const [user] = await db
      .insert(users)
      .values({
        ...userData,
        role,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          role,
          updatedAt: new Date(),
        },
      })
      .returning();
    
    console.log(`[Auth] User upserted: ${user.email}, role: ${user.role}`);
    return user;
  }
}

export const authStorage = new AuthStorage();
