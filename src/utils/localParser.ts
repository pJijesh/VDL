import * as pdfjsLib from "pdfjs-dist";
import { ExtractedManifest, Consignment, ManifestMetadata } from "../types.js";

// Set worker source to CDN to avoid Vite asset worker bundling compatibility bugs
const version = pdfjsLib.version || "4.10.38";
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

interface PDFTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Extracts and parses a customs manifest PDF entirely client-side using PDF.js text layer structures.
 */
export async function parsePdfLocally(fileArrayBuffer: ArrayBuffer): Promise<ExtractedManifest> {
  const loadingTask = pdfjsLib.getDocument({ data: fileArrayBuffer });
  const pdf = await loadingTask.promise;
  
  let allLines: string[] = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    // Map raw elements to typed objects
    const items: PDFTextItem[] = textContent.items.map((item: any) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width || 0,
      height: item.height || item.transform[3] || 0,
    }));
    
    // Group text items into visual rows by rounding Y coordinate (lines are generally > 8px height)
    const rowTolerance = 6; 
    const rowsMap = new Map<number, PDFTextItem[]>();
    
    items.forEach(item => {
      let foundRowY: number | null = null;
      for (const keyY of rowsMap.keys()) {
        if (Math.abs(keyY - item.y) <= rowTolerance) {
          foundRowY = keyY;
          break;
        }
      }
      
      if (foundRowY !== null) {
        rowsMap.get(foundRowY)!.push(item);
      } else {
        rowsMap.set(item.y, [item]);
      }
    });
    
    // Sort rows from top-to-bottom (Y coordinate descending)
    const sortedRowKeys = Array.from(rowsMap.keys()).sort((a, b) => b - a);
    
    sortedRowKeys.forEach(y => {
      const rowItems = rowsMap.get(y)!;
      // Sort items within research row from left-to-right (X coordinate ascending)
      rowItems.sort((a, b) => a.x - b.x);
      
      // Combine close elements on the same row or join with spaces
      let rowText = "";
      rowItems.forEach((item, index) => {
        if (index === 0) {
          rowText += item.text;
        } else {
          // Add space if there is a visual gap
          const prevItem = rowItems[index - 1];
          const gap = item.x - (prevItem.x + prevItem.width);
          if (gap > 3) {
            rowText += " " + item.text;
          } else {
            rowText += item.text;
          }
        }
      });
      
      if (rowText.trim().length > 0) {
        allLines.push(rowText.trim());
      }
    });
  }
  
  return extractStructureFromLines(allLines);
}

function extractStructureFromLines(lines: string[]): ExtractedManifest {
  const metadata: ManifestMetadata = {
    route: "",
    date: "",
    tripOrRitNumber: "",
    truck: "",
    driver: "",
    trailer: "",
  };
  
  const consignments: Consignment[] = [];
  let consignmentBuffer: string[] = [];
  
  // High-precision Regex anchors
  const referenceRegex = /\b\d{5,6}\/\d{1,4}\b/; // Matches '954303/33' or '954582/5'
  const dateRegex = /\b\d{2}-\d{2}-\d{4}\b/g; // Matches '13-05-2026'
  const customsDeclRegex = /\bIR-\d{4}-\d{5}\b/i; // Matches 'IR-2605-05532'
  const extraCodeRegex = /\b(2026\.\d+|766\d+|707\d+)\b/; // Matches other custom tracking numerical codes
  
  // Specific patterns to extract metadata (including Dutch synonyms)
  const ritRegex = /\b(?:rit|trip|ritnummer)\s*:?\s*(\d+)/i;
  const truckRegex = /\b(?:truck|truck:|kenteken|vrachtwagen)\s*:?\s*(.+?)(?=\s+(?:chauffeur|driver|trailer|oplegger|duration|cargo|$))/i;
  const driverRegex = /\b(?:chauffeur|driver)\s*:?\s*([A-Za-z\s'\-]+?)(?=\s+(?:trailer|oplegger|truck|kenteken|cargo|date|$))/i;
  const trailerRegex = /\b(?:trailer|oplegger)\s*:?\s*(.+?)(?=\s+(?:chauffeur|driver|truck|kenteken|$))/i;
  const customsRouteRegex = /\bCustoms\s+(\d+\.\s*[A-Za-z\s]+)/i;
  
  // Month lookup to capture manifest string date
  const dutchMonths = /\b(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|mei|jan|feb|mrt|apr|jun|jul|aug|sep|okt|nov|dec)\b/i;
  
  lines.forEach(line => {
    const rawLine = line.trim();
    if (!rawLine) return;
    
    // Check if line contains metadata items
    let matchedMetadata = false;
    
    // Extract Rit or Trip number in this line
    const ritMatch = rawLine.match(ritRegex);
    if (ritMatch && !metadata.tripOrRitNumber) {
      metadata.tripOrRitNumber = ritMatch[1];
      matchedMetadata = true;
    }
    
    // Extract Truck
    const truckMatch = rawLine.match(truckRegex);
    if (truckMatch && !metadata.truck) {
      metadata.truck = truckMatch[1].trim();
      matchedMetadata = true;
    }
    
    // Extract Driver
    const driverMatch = rawLine.match(driverRegex);
    if (driverMatch && !metadata.driver) {
      metadata.driver = driverMatch[1].trim();
      matchedMetadata = true;
    }
    
    // Extract Trailer
    const trailerMatch = rawLine.match(trailerRegex);
    if (trailerMatch && !metadata.trailer) {
      metadata.trailer = trailerMatch[1].trim();
      matchedMetadata = true;
    }
    
    // Extract Customs and Route description
    const customsRouteMatch = rawLine.match(customsRouteRegex);
    if (customsRouteMatch && !metadata.route) {
      metadata.route = customsRouteMatch[1].trim();
      matchedMetadata = true;
    }
    
    // Extract manifest date if any line has Dutch date structure
    if (dutchMonths.test(rawLine) && !metadata.date && (rawLine.includes("mei") || rawLine.includes("2026"))) {
      // Find clean substring ending in year
      const dateMatch = rawLine.match(/(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)?\s*\d{1,2}\s+[a-z]+\s+\d{4}/i);
      if (dateMatch) {
        metadata.date = dateMatch[0].trim();
        matchedMetadata = true;
      }
    }
    
    // Accumulate lines if they are not exclusively metadata titles
    if (!matchedMetadata && !rawLine.startsWith("Trip Truck") && !rawLine.startsWith("Trailer") && !rawLine.startsWith("Rit Truck")) {
      consignmentBuffer.push(rawLine);
      
      // If line contains reference number, we reached the boundary of a consignment box!
      if (referenceRegex.test(rawLine)) {
        parseConsignmentBlock(consignmentBuffer, consignments);
        consignmentBuffer = [];
      }
    }
  });
  
  // Fallback for residual elements inside the buffer
  if (consignmentBuffer.length > 0 && consignmentBuffer.some(l => dateRegex.test(l))) {
    parseConsignmentBlock(consignmentBuffer, consignments);
  }
  
  // Clean up any residual loose values inside headers from layout
  if (!metadata.tripOrRitNumber) {
    const backupRit = lines.find(l => /\b(?:rit|trip|ritnummer)\s+(\d{5,6})\b/i.test(l) || /^[RrtT]i?p?nummer?\s*(\d{5,6})$/i.test(l));
    if (backupRit) {
      const match = backupRit.match(/\d+/);
      metadata.tripOrRitNumber = match ? match[0] : "";
    } else {
      // Look for a pure 6-digit number starting with 4 (representing Rit)
      const standaloneRit = lines.find(l => /^(4\d{5})$/.test(l.trim()));
      if (standaloneRit) {
        metadata.tripOrRitNumber = standaloneRit.trim();
      }
    }
  }
  
  // Backup for Trailer if the line has been interleaved/broken
  if (!metadata.trailer) {
    // 1. Look for a label like "Trailer" or "Oplegger" and search next few lines
    const trailerLabelIdx = lines.findIndex(l => /\b(?:trailer|oplegger)\b/i.test(l));
    if (trailerLabelIdx !== -1) {
      for (let offset = 1; offset <= 3; offset++) {
        const nextIdx = trailerLabelIdx + offset;
        if (nextIdx < lines.length) {
          const nextLine = lines[nextIdx].trim();
          if (nextLine && !/\b(?:rit|trip|truck|chauffeur|driver|customs|donderdag|vrijdag|woensdag|dinsdag|maandag|zaterdag|zondag|b\.v\.|ltd|inc|gmbh|co\.)\b/i.test(nextLine)) {
            // Check if it looks like a registration plate (numbers + letters, length >= 6)
            if (/\d+/.test(nextLine) && /[A-Z]+/i.test(nextLine) && nextLine.length >= 6) {
              metadata.trailer = nextLine;
              break;
            }
          }
        }
      }
    }

    // 2. Look for any line matching exact Dutch or generic trailer plate formats like "7063 - OP-99-ZK" or "OR-84-XX"
    if (!metadata.trailer) {
      const platePattern = /\b\d{4}\s*-\s*[A-Z0-9-]{4,20}\b/i;
      const plateMatch = lines.find(l => platePattern.test(l));
      if (plateMatch) {
        const matched = plateMatch.match(platePattern);
        if (matched) {
          metadata.trailer = matched[0].trim();
        }
      }
    }

    // 3. Look for "7063 - OP-99-ZK" style anywhere in the first page lines
    if (!metadata.trailer) {
      const backupPlatePattern = /\b\d{4}\s*-\s*[A-Z0-9]{2,4}\s*-\s*[A-Z0-9]{2,4}\b/i;
      const backupMatch = lines.find(l => backupPlatePattern.test(l));
      if (backupMatch) {
         const matched = backupMatch.match(backupPlatePattern);
         if (matched) {
           metadata.trailer = matched[0].trim();
         }
      }
    }
  }
  
  if (metadata.trailer) {
    metadata.trailer = sanitizeTrailer(metadata.trailer);
  }
  
  return { metadata, consignments };
}

/**
 * Clean up trailer values that might have had consignment details or overflow text bleed in because of multi-column visual rows
 */
export function sanitizeTrailer(val: string): string {
  let cleaned = val.trim();
  
  // Reject company, consignment lists, or POD details entirely
  if (/\b(?:b\.v\.|ltd|inc|gmbh|co\.|pod|farmer|evri|hermes|adomex|flowerline|visser|heemskerk|bloomon|delivery|rugby|harwich)\b/i.test(cleaned)) {
    // Check if there is a valid trailer plate structure embedded in this noise (e.g. "9032-1 - OR-05-SR")
    const innerPlate = cleaned.match(/\b\d{3,5}\s*(?:-\s*\d+)?\s*-\s*[A-Z0-9-]{4,15}\b/i);
    if (innerPlate) {
      return innerPlate[0].trim();
    }
    return "";
  }
  
  // 1. If it contains a date in DD-MM-YYYY format, truncate at the date
  const dateIndex = cleaned.search(/\d{2}-\d{2}-\d{4}/);
  if (dateIndex !== -1) {
    cleaned = cleaned.substring(0, dateIndex).trim();
  }
  
  // 2. Truncate at common non-trailer keywords (like sending details)
  const docKeywords = /\b(farmer|evri|hermes|loading|unload|address|pod|consign|delivery|rugby|harwich)\b/i;
  const kwIndex = cleaned.search(docKeywords);
  if (kwIndex !== -1) {
    cleaned = cleaned.substring(0, kwIndex).trim();
  }

  // 3. Remove trailing dashes, commas, or spaces
  cleaned = cleaned.replace(/[\s,-]+$/, "").trim();

  // 4. Extract standard license-plate structures if the string starts with one but has leftover clutter
  // e.g. "7092 - OR-56-XH some leftover text" -> "7092 - OR-56-XH"
  const platePattern = /^(\d{3,5}\s*(?:-\s*\d+)?\s*-\s*[A-Z0-9-]{4,15})\b/i;
  const match = cleaned.match(platePattern);
  if (match) {
    return match[1].trim();
  }

  return cleaned;
}

/**
 * Parses a buffered set of lines representing a single consignment box.
 */
function parseConsignmentBlock(blockLines: string[], consignments: Consignment[]): void {
  // Join all items to inspect dates and documents
  const blockText = blockLines.join(" ");
  
  const referenceRegex = /\b\d{5,6}\/\d{1,4}\b/;
  const dateRegex = /\b\d{2}-\d{2}-\d{4}\b/g;
  const customsDeclRegex = /\bIR-\d{4}-\d{5}\b/i;
  const extraCodeRegex = /\b(2026\.\d+|766\d+|707\d+)\b/;
  
  // Find reference number
  const refMatch = blockText.match(referenceRegex);
  const referenceNumber = refMatch ? refMatch[0] : "N/A";
  
  // Find all dates in this block
  const dates = blockText.match(dateRegex) || [];
  const loadingDate = dates[0] || "";
  const deliveryDate = dates[1] || loadingDate; // fallback to loading if only one date is present
  
  // Find customs declaration number (e.g. IR-2605-05532)
  const customsDeclMatch = blockText.match(customsDeclRegex);
  const customsDeclaration = customsDeclMatch ? customsDeclMatch[0] : undefined;
  
  // Find any extra numerical codes
  const extraMatch = blockText.match(extraCodeRegex);
  const additionalCode = extraMatch ? extraMatch[0] : undefined;
  
  // Extract Consignor and Consignee names!
  // Our visual analysis showed:
  // - Consignor appears before the loading date (or is at the top of the block)
  // - Consignee appears between the first date (loading) and second date (delivery) [or near the bottom]
  
  let consignor = "";
  let consignee = "";
  
  // Let's sweep the lines to distribute them between Consignor and Consignee based on dates
  let foundFirstDate = false;
  let foundSecondDate = false;
  
  blockLines.forEach(line => {
    const cleanLine = line.trim();
    if (!cleanLine) return;
    
    // Skip reference line or helper decorations
    if (cleanLine === referenceNumber || cleanLine.match(/^\+?\d+$/)) return;
    if (customsDeclaration && cleanLine.includes(customsDeclaration)) return;
    if (additionalCode && cleanLine.includes(additionalCode)) return;
    
    const containsDate = cleanLine.match(/\d{2}-\d{2}-\d{4}/);
    
    if (containsDate) {
      if (!foundFirstDate) {
        foundFirstDate = true;
      } else {
        foundSecondDate = true;
      }
      return; // Skip line containing the date itself
    }
    
    // Distribute text to Consignor vs Consignee
    if (!foundFirstDate) {
      // Any text line before the loading date is part of consignor name/address
      consignor += (consignor ? ", " : "") + cleanLine;
    } else if (!foundSecondDate) {
      // Any text line after loading date but before delivery date is consignee
      consignee += (consignee ? ", " : "") + cleanLine;
    } else {
      // Leftover text lines
      consignee += (consignee ? ", " : "") + cleanLine;
    }
  });
  
  // Clean up Consignor or Consignee text by removing any reference numbers or codes that bled in
  const cleanupText = (text: string) => {
    return text
      .replace(referenceRegex, "")
      .replace(customsDeclRegex, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^,\s*|,\s*$/g, "");
  };
  
  consignor = cleanupText(consignor);
  consignee = cleanupText(consignee);
  
  // If we couldn't separate, set reasonable fallbacks
  if (!consignor) {
    consignor = "Unknown Sender";
  }
  if (!consignee) {
    consignee = "Unknown Recipient";
  }
  
  const idValue = referenceNumber !== "N/A" ? referenceNumber : `C-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  
  consignments.push({
    id: idValue,
    loadingDate,
    consignor,
    deliveryDate,
    consignee,
    referenceNumber,
    customsDeclaration,
    additionalCode,
  });
}
