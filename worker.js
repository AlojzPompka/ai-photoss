const ALLOWED_ORIGIN = "https://aloizpompka.github.io";
const MODEL = "@cf/runwayml/stable-diffusion-v1-5-inpainting";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
      "Vary": "Origin",
      "Cache-Control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Origin not allowed", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
          "Vary": "Origin"
        }
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "online" });
    }

    if (url.pathname !== "/edit") {
      return json({ error: "Nie znaleziono endpointu." }, 404);
    }

    if (request.method !== "POST") {
      return json({ error: "Wymagana metoda POST." }, 405);
    }

    if (!env.APP_PASSWORD) {
      return json({ error: "Brak sekretu APP_PASSWORD w Cloudflare." }, 500);
    }

    if (request.headers.get("X-App-Password") !== env.APP_PASSWORD) {
      return json({ error: "Nieprawidłowy kod dostępu." }, 401);
    }

    if (!env.AI) {
      return json({ error: "Brak bindingu Workers AI o nazwie AI." }, 500);
    }

    try {
      const form = await request.formData();
      const image = form.get("image");
      const mask = form.get("mask");
      const prompt = form.get("prompt");

      if (!(image instanceof File) ||
          typeof prompt !== "string" ||
          !prompt.trim()) {
        return json({ error: "Brakuje zdjęcia lub opisu." }, 400);
      }

      if (!(mask instanceof File)) {
        return json({
          error: "Strona nie wysłała maski. Trzeba poprawić index.html."
        }, 400);
      }

      if (image.size > 5 * 1024 * 1024 ||
          mask.size > 5 * 1024 * 1024) {
        return json({ error: "Zdjęcie lub maska przekracza 5 MB." }, 413);
      }

      const imageBytes = new Uint8Array(await image.arrayBuffer());
      const maskBytes = new Uint8Array(await mask.arrayBuffer());

      const result = await env.AI.run(MODEL, {
        image: Array.from(imageBytes),
        mask: Array.from(maskBytes),
        prompt: prompt.trim().slice(0, 1000)
      });

      if (!result || !result.image) {
        return json({ error: "Model nie zwrócił obrazu." }, 502);
      }

      let output;

      if (typeof result.image === "string") {
        const binary = atob(result.image);
        output = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i++) {
          output[i] = binary.charCodeAt(i);
        }
      } else {
        output = new Uint8Array(result.image);
      }

      return new Response(output, {
        headers: {
          "Content-Type": "image/png",
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Vary": "Origin",
          "Cache-Control": "no-store"
        }
      });
    } catch (error) {
      console.error("Photo edit error:", error);

      return json({
        error: "Błąd AI: " +
          String(error?.message || error).slice(0, 400)
      }, 500);
    }
  }
};
