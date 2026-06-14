import { GoogleGenAI, Type } from "@google/genai";

// Ensure we fail-fast at runtime with a clear error message instead of crashing at module load
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

export interface ManifestMetadata {
  route: string;
  date: string;
  tripOrRitNumber: string;
  truck: string;
  driver: string;
  trailer: string;
  isPriority?: boolean;
  truckLabel?: string;
  port?: string;
}

export interface Consignment {
  id: string;
  loadingDate: string;
  consignor: string;
  deliveryDate: string;
  consignee: string;
  referenceNumber: string;
  customsDeclaration?: string;
  additionalCode?: string;
  who?: string;
  status?: string;
  t2?: string;
  jobNumber?: string;
  ens?: string;
  readyForHaulier?: string;
  notes?: string;
}

export interface ExtractedManifest {
  metadata: ManifestMetadata;
  consignments: Consignment[];
}

export async function parsePdfWithGemini(pdfBase64: string, mimeType: string = "application/pdf"): Promise<ExtractedManifest> {
  const ai = getAiClient();

  const pdfPart = {
    inlineData: {
      data: pdfBase64,
      mimeType: mimeType,
    },
  };

  const prompt = `
    You are a professional customs logistics auditor. Your task is to extract all structured data from this customs manifest document.
    
    Examine the header to extract the following manifest metadata:
    - Date (e.g. "woensdag 13 mei 2026" or "dinsdag 12 mei 2026")
    - Route / Location of customs (e.g. "11. Immingham", "18. Folkestone opbrengen Calais", "15. Harwich", etc. usually labeled next to "Customs")
    - Rit / Trip / Job number (e.g. "436673", "436805", etc. usually starts with 4 or is a 6-digit number)
    - Truck (e.g. "1083 - 01-BJS-1", "1230 - 36-BRL-5", "BD-262-F")
    - Chauffeur / Driver name (e.g. "Jaap van den Berg", "Krzysztof Makosza", "Martin Biddle", "Mieczyslaw Bojara")
    - Trailer (often labeled as "Trailer" or "Oplegger" in Dutch, e.g. "7107 - OR-84-XX- VDL", "7070 - OV-91-GB", "CHARTER EIGEN TRAILER", or empty string if none)

    Then, extract all consignment listings from the main body.
    Consignments are displayed in horizontal blocks/boxes separated by lines.
    Each consignment must contain:
    - loadingDate (typically a date in DD-MM-YYYY format matching when the goods are sent, usually on the left side)
    - consignor (the sender name and address, e.g., "Impulse Plants - Wijk en Aalburg" or "Bloomon Nederland B.V. - Amstelveen" on the left side)
    - deliveryDate (typically a date in DD-MM-YYYY format matching when the goods arrive, usually on the right side)
    - consignee (the receiver name and address, e.g., "Williamson Design Florist Ltd., Uphall" on the right side)
    - referenceNumber (the tracking reference formatted with a slash, e.g. "954303/33", "954582/5", "947123/2", "954613/1")
    - customsDeclaration (red / colored code numbers if present, starting with "IR-", e.g., "IR-2605-05532", "IR-2605-05509", "IR-2605-05526")
    - additionalCode (any remaining loose numbers found, such as "2026.7668904", "7663188", "7663399", etc. or "+5" counts)

    Extract EVERYTHING with high precision. Do not skip any consignment boxes.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [pdfPart, prompt],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          metadata: {
            type: Type.OBJECT,
            properties: {
              route: { type: Type.STRING, description: "Route / Location of customs, e.g. '11. Immingham'" },
              date: { type: Type.STRING, description: "Date of the manifest, e.g. 'woensdag 13 mei 2026'" },
              tripOrRitNumber: { type: Type.STRING, description: "Rit or Trip or Job number" },
              truck: { type: Type.STRING, description: "Truck registration plate / identification" },
              driver: { type: Type.STRING, description: "Driver or Chauffeur name" },
              trailer: { type: Type.STRING, description: "Trailer ID or type" },
            },
            required: ["route", "date", "tripOrRitNumber", "truck", "driver", "trailer"],
          },
          consignments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "Row index or arbitrary unique identifier" },
                loadingDate: { type: Type.STRING, description: "Loading date in DD-MM-YYYY" },
                consignor: { type: Type.STRING, description: "Consignor (sender) name and city" },
                deliveryDate: { type: Type.STRING, description: "Delivery date in DD-MM-YYYY" },
                consignee: { type: Type.STRING, description: "Consignee (recipient) name and city" },
                referenceNumber: { type: Type.STRING, description: "Reference tracking number, e.g. 954303/33" },
                customsDeclaration: { type: Type.STRING, description: "Optional customs code e.g. IR-2605-05532" },
                additionalCode: { type: Type.STRING, description: "Optional extra tracking code" },
              },
              required: ["id", "loadingDate", "consignor", "deliveryDate", "consignee", "referenceNumber"],
            },
          },
        },
        required: ["metadata", "consignments"],
      },
    },
  });

  const parsedText = response.text || "{}";
  return JSON.parse(parsedText) as ExtractedManifest;
}
