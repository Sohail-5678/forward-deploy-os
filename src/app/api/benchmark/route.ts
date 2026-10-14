import { apiRoute, json } from "@/lib/server/http";
import results from "../../../../benchmarks/results.json";

/** GET /api/benchmark: the committed benchmarks/results.json produced by `npm run bench`. */
export const GET = apiRoute({ name: "benchmark", limit: { max: 120 }, sameOrigin: false }, async () => {
  return json(results, { headers: { "cache-control": "public, max-age=300, s-maxage=3600" } });
});
