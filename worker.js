
const MODEL = "@cf/runwayml/stable-diffusion-v1-5-inpainting";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
      "Cache-Control": "no-store"
    }
  });
}

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, X-App-Password"
  );
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, X-App-Password",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    if (url.pathname === "/health") {
      return json({ status: "online" });
    }

    if (url.pathname !== "/edit") {
      return json({ error: "Nie znaleziono endpointu." }, 404);
    }

    if (request.method !== "POST") {
      return json({ error: "Dozwolona jest metoda POST." }, 405);
    }

    const password = env.APP_PASSWORD;
    if (!password) {
      return json({
        error: "Brak sekretu APP_PASSWORD w ustawieniach Workera."
      }, 500);
    }

    if (request.headers.get("X-App-Password") !== password) {
      return json({ error: "Nieprawidłowe hasło aplikacji." }, 401);
    }

    if (!env.AI) {
      return json({
        error: "Brak bindingu Workers AI o nazwie AI."
      }, 500);
    }

    try {
      const form = await request.formData();
      const image = form.get("image");
      const mask = form.get("mask");
      const prompt = String(form.get("prompt") || "").trim();

      if (!image || typeof image.arrayBuffer !== "function") {
        return json({ error: "Nie otrzymałem zdjęcia." }, 400);
      }

      if (!mask || typeof mask.arrayBuffer !== "function") {
        return json({ error: "Nie otrzymałem maski." }, 400);
      }

      if (!prompt) {
        return json({ error: "Wpisz opis zmiany." }, 400);
      }

      if (image.size > 10 * 1024 * 1024 ||
          mask.size > 10 * 1024 * 1024) {
        return json({
          error: "Zdjęcie lub maska przekracza 10 MB."
        }, 413);
      }

      const imageBytes = new Uint8Array(await image.arrayBuffer());
      const maskBytes = new Uint8Array(await mask.arrayBuffer());

      const result = await env.AI.run(MODEL, {
        prompt,
        image: Array.from(imageBytes),
        mask: Array.from(maskBytes),
        num_steps: 20,
        strength: 1,
        guidance: 7.5
      });

      let output = result?.image ?? result;

      if (output instanceof ReadableStream) {
        return cors(new Response(output, {
          headers: { "Content-Type": "image/png" }
        }));
      }

      if (output instanceof Uint8Array ||
          output instanceof ArrayBuffer) {
        return cors(new Response(output, {
          headers: { "Content-Type": "image/png" }
        }));
      }

      if (Array.isArray(output)) {
        return cors(new Response(new Uint8Array(output), {
          headers: { "Content-Type": "image/png" }
        }));
      }

      if (typeof output === "string") {
        const base64 = output.replace(
          /^data:image\/[^;]+;base64,/,
          ""
        );
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return cors(new Response(bytes, {
          headers: { "Content-Type": "image/png" }
        }));
      }

      return json({
        error: "Model zwrócił nieoczekiwany format wyniku.",
        resultType: typeof result,
        resultKeys: result && typeof result === "object"
          ? Object.keys(result)
          : []
      }, 502);

    } catch (error) {
      return json({
        error: "Błąd edycji AI.",
        details: String(error?.message || error).slice(0, 1200)
      }, 500);
    }
  }
};
