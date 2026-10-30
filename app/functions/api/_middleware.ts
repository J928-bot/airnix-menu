import { type Env, json } from "../../src/lib";

// /api/ の全部に共通：別サイトからの送信を断る・キャッシュさせない・想定外のエラーを短い文で返す
// （functions/api/ に置くことで、画面のファイル（HTML・画像）の配信ではFunctionsが動かない＝無料枠を使わない）
export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request } = ctx;
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin !== url.origin) return json({ error: "この画面からは送信できません" }, 403);
  }
  let res: Response;
  try {
    res = await ctx.next();
  } catch (e) {
    console.error(e);
    res = json({ error: "うまく処理できませんでした。時間をおいてもう一度お試しください" }, 500);
  }
  // 存在しないAPI（または対応していない送り方）は、画面のHTMLではなくJSONの404を返す
  if (!(res.headers.get("content-type") || "").startsWith("application/json")) {
    res = json({ error: "見つかりませんでした" }, 404);
  }
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "no-store");
  out.headers.set("x-content-type-options", "nosniff");
  return out;
};
