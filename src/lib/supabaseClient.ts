import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : "") as string;
const supabaseAnonKey = (typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : "") as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY - auth will be disabled");
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : (null as unknown as ReturnType<typeof createClient>);
