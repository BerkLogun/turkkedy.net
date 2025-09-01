interface Env {
  cats: R2Bucket;
}

export const onRequest: PagesFunction<Env> = async ({ env }) => {
  const obj = await env.cats.get('manifest.json');
  if (!obj) {
    return new Response(
      JSON.stringify({ 
        error: "manifest.json not found in R2. Run /api/admin/rebuild-manifest?key=..." 
      }),
      { 
        status: 404, 
        headers: { 
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*"
        } 
      }
    );
  }
  
  const headers = new Headers(obj.httpMetadata ?? {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "public, max-age=300"); // 5 min at edge
  headers.set("access-control-allow-origin", "*");
  
  return new Response(await obj.text(), { headers });
};
  
