import "next-auth";
import "next-auth/adapters";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      vpsBotQuota: number;
      stripeCustomerId: string | null;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/adapters" {
  interface AdapterUser {
    vpsBotQuota: number;
    stripeCustomerId: string | null;
  }
}
