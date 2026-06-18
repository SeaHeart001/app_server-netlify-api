
export default async (request, context) => {
  // const url = new URL("/.netlify/edge-functions/sse", "https://xionglanying.netlify.app");
  // const res = await fetch(url);
  return new Response("Hello, World!", {
    headers: { "content-type": "text/html" }
  });
};

export const config = {
  path: "/.netlify/edge-functions/hello",
};
