import { createClient } from "@supabase/supabase-js";
import { durableAuthStorage } from "./durableAuthStorage";

const DEFAULT_SUPABASE_URL = "https://kdrgxnooesttppyhkoin.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtkcmd4bm9vZXN0dHBweWhrb2luIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NzQ3MjIsImV4cCI6MjA5ODI1MDcyMn0.g7asmjmArz5xKoUN0X2uGLRBQOcx0nKvdNMBSQPuK5U";

const supabaseUrl =
  ((typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) || DEFAULT_SUPABASE_URL) as string;
const supabaseAnonKey =
  ((typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_ANON_KEY) || DEFAULT_SUPABASE_ANON_KEY) as string;

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: durableAuthStorage,
        },
      })
    : (null as unknown as ReturnType<typeof createClient>);
