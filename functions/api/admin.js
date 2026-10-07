export async function onRequest() {
  return Response.json({
    ok: true,
    message: "Admin API is working"
  });
}
