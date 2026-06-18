// export default async (req, context) => {
//     const body = await req.json();
//
//     return context.next(new Request(req, { body: JSON.stringify(body) }));
// };

export default async (request, context) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(JSON.stringify({request: request.url})));

            setInterval(() => {
                console.log(request)
                controller.enqueue(encoder.encode(JSON.stringify({request: request.url})));
            }, 1000000)
        },
    });

    return new Response(body, {
        headers: {
            "Content-Type": "text/event-stream",
        },
    });
};

export const config = {
    path: "/.netlify/edge-functions/sse",
};
