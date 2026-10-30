import { type Env, json, endSession } from "../../src/lib";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) =>
  json({ ok: true }, 200, { "set-cookie": await endSession(request, env, "member") });
