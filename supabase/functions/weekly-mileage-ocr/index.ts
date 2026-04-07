// @ts-nocheck

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

type IncomingImage = {
  file_name?: string;
  mime_type?: string;
  image_data_url?: string;
  source_index?: number;
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function getSelectedModel() {
  return globalThis.process?.env?.OPENAI_OCR_MODEL ?? Deno.env.get("OPENAI_OCR_MODEL") ?? "gpt-4.1-mini";
}

function buildSchema() {
  return {
    name: "weekly_mileage_rows",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              week_ending: { type: "string" },
              driver_name: { type: "string" },
              vehicle_reg: { type: "string" },
              odometer_reading: { type: "string" },
              source_image_name: { type: "string" },
              source_index: { type: "number" },
              notes: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: [
              "week_ending",
              "driver_name",
              "vehicle_reg",
              "odometer_reading",
              "source_image_name",
              "source_index",
              "notes"
            ]
          }
        }
      },
      required: ["rows"]
    }
  };
}

function extractOutputText(payload: Record<string, unknown>) {
  const directText = payload.output_text;
  if (typeof directText === "string" && directText.trim()) {
    return directText;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content)
      ? ((item as { content?: unknown[] }).content as unknown[])
      : [];

    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const textValue = (part as { text?: unknown }).text;
      if (typeof textValue === "string" && textValue.trim()) {
        return textValue;
      }
    }
  }

  return "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const executionId = Deno.env.get("SB_EXECUTION_ID") ?? "unknown";
  const deploymentId = Deno.env.get("DENO_DEPLOYMENT_ID") ?? "unknown";

  try {
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const selectedModel = getSelectedModel();
    const body = (await request.json()) as { images?: IncomingImage[] };
    const mode = typeof (body as { mode?: unknown }).mode === "string" ? String((body as { mode?: unknown }).mode) : "";
    const images = Array.isArray(body.images) ? body.images : [];

    console.log("weekly-mileage-ocr request", {
      model: selectedModel,
      imageCount: images.length,
      hasOpenAiKey: Boolean(openAiKey),
      executionId,
      deploymentId
    });

    if (mode === "health") {
      return jsonResponse({
        ok: true,
        message: "weekly-mileage-ocr is reachable.",
        executionId,
        deploymentId,
        hasOpenAiKey: Boolean(openAiKey),
        model: selectedModel
      });
    }

    if (!openAiKey) {
      console.error("weekly-mileage-ocr missing OPENAI_API_KEY", { executionId, deploymentId });
      return jsonResponse({
        ok: false,
        rows: [],
        error: {
          code: "MISSING_OPENAI_API_KEY",
          message: "OPENAI_API_KEY is not set for the weekly-mileage-ocr function.",
          executionId,
          deploymentId
        }
      });
    }

    if (!images.length) {
      return jsonResponse({
        ok: false,
        rows: [],
        error: {
          code: "NO_IMAGES",
          message: "No images were provided.",
          executionId,
          deploymentId
        }
      });
    }

    const inputContent = [
      {
        type: "input_text",
        text:
          "You extract weekly mileage rows from photographed handwritten sheets. Each row belongs to one vehicle and each column belongs to one week-ending date. Never mix values across columns or weeks. Focus on vehicle registrations like 61-2835 and odometer values that are usually 5 to 7 digits. Ignore scribbles, crossed-out cells, strike-through values, decorative marks, and empty boxes. If a row is too unclear, omit it instead of guessing. Return one row per usable vehicle/week cell and include short notes when anything looks uncertain."
      },
      ...images.flatMap((image, index) => {
        const fileName = image.file_name ?? `image-${index + 1}.jpg`;
        return [
          {
            type: "input_text",
            text: `Image ${index + 1}: ${fileName}`
          },
          {
            type: "input_image",
            image_url: image.image_data_url,
            detail: "high"
          }
        ];
      })
    ];

    let response: Response;

    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: selectedModel,
          input: [
            {
              role: "user",
              content: inputContent
            }
          ],
          text: {
            format: {
              type: "json_schema",
              ...buildSchema()
            }
          }
        })
      });
    } catch (error) {
      const exactMessage = error instanceof Error ? error.message : String(error);
      console.error("weekly-mileage-ocr openai request threw", {
        model: selectedModel,
        imageCount: images.length,
        hasOpenAiKey: Boolean(openAiKey),
        exactMessage,
        executionId,
        deploymentId
      });
      return jsonResponse(
        {
          success: false,
          error: exactMessage,
          model: selectedModel
        },
        500
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("weekly-mileage-ocr openai error", {
        model: selectedModel,
        executionId,
        deploymentId,
        status: response.status,
        errorText
      });
      return jsonResponse({
        ok: false,
        rows: [],
        error: {
          code: "OPENAI_REQUEST_FAILED",
          message: "OpenAI OCR request failed.",
          details: errorText,
          model: selectedModel,
          executionId,
          deploymentId,
          status: response.status
        }
      });
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const outputText = extractOutputText(payload);
    if (!outputText) {
      console.error("weekly-mileage-ocr missing output_text", { executionId, deploymentId, payload });
      return jsonResponse({
        ok: false,
        rows: [],
        error: {
          code: "EMPTY_MODEL_OUTPUT",
          message: "The OCR model returned an empty response.",
          model: selectedModel,
          executionId,
          deploymentId
        }
      });
    }

    const parsed = JSON.parse(outputText) as { rows: unknown[] };
    return jsonResponse({
      ok: true,
      rows: parsed.rows ?? [],
      model: selectedModel,
      executionId,
      deploymentId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected OCR function error.";
    console.error("weekly-mileage-ocr error", {
      executionId,
      deploymentId,
      message,
      error
    });
    return jsonResponse({
      ok: false,
      rows: [],
      error: {
        code: "UNEXPECTED_ERROR",
        message,
        executionId,
        deploymentId
      }
    });
  }
});
