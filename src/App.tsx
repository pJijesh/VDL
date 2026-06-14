import React, { useState, useEffect, useRef } from "react";
import { 
  FileDown, 
  Upload, 
  Settings, 
  FileText, 
  Sparkles, 
  Cpu, 
  Plus, 
  Trash2, 
  Search, 
  Edit3, 
  Check, 
  X, 
  History, 
  FolderOpen, 
  Briefcase, 
  Truck, 
  User, 
  Calendar, 
  MapPin, 
  Loader2, 
  Layers, 
  AlertCircle,
  TrendingUp,
  ExternalLink,
  ChevronRight,
  ClipboardCheck,
  CheckCircle2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ExtractedManifest, Consignment, ManifestMetadata, ExtractionHistoryEntry } from "./types.js";
import { parsePdfLocally, sanitizeTrailer } from "./utils/localParser.js";

function parseTruckFromFilename(filename: string): string {
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
  
  // Case 1: Look for patterns like "truck_1234" or "truck 1083" or "truck-99" (case insensitive)
  const truckLabelMatch = nameWithoutExt.match(/truck[_\s\-:]*([a-zA-Z0-9\-]+)/i);
  if (truckLabelMatch && truckLabelMatch[1]) {
    const matched = truckLabelMatch[1].trim();
    if (matched.length >= 2) return matched;
  }
  
  // Case 2: Standard license plate pattern, e.g. "01-BJS-1" or "36-BRL-5"
  const plateMatch = nameWithoutExt.match(/\b\d{2}-[a-zA-Z]{3}-\d\b|\b[a-zA-Z]{2}-\d{2}-[a-zA-Z]{2}\b|\b\d{2}-[a-zA-Z]{2}-[a-zA-Z]{2}\b/);
  if (plateMatch) {
    return plateMatch[0];
  }
  
  // Case 3: Let's split by underscore, space, hyphen and check for 3-4 digit truck IDs
  const tokens = nameWithoutExt.split(/[_\s\-]+/);
  for (const token of tokens) {
    if (/^\d{3,4}$/.test(token) && !token.includes("2026") && token !== "7107" && token !== "7070") {
      return token;
    }
  }

  // Case 4: Any word that's a 3-8 character alphanumeric that looks like an ID, excluding known words
  const ignoreList = ["sample", "customs", "immingham", "manifest", "prio", "report", "pdf", "trip", "rit", "date", "cavalry", "transport"];
  for (const token of tokens) {
    if (token && isNaN(Number(token)) && !ignoreList.includes(token.toLowerCase()) && token.length >= 3 && token.length <= 15) {
      return token;
    }
  }
  
  return "";
}

function checkIsFileNamePriority(filename: string): boolean {
  return filename.toUpperCase().includes("PRIO");
}

function detectPort(route: string, filename: string): string {
  const combined = `${route} ${filename}`.toLowerCase();
  if (combined.includes("immingham")) return "Immingham";
  if (combined.includes("harwich")) return "Harwich";
  if (combined.includes("felixstowe")) return "Felixstowe";
  if (combined.includes("folkestone") || combined.includes("coquelles")) return "Folkestone";
  return "Immingham"; // default port station
}

function suggestTruckLabel(filename: string, existingHistoryCount: number): string {
  const match = filename.match(/truck[_\s\-]*(\d+[a-z]?)/i);
  if (match && match[1]) {
    return "Truck " + match[1];
  }
  return `Truck ${existingHistoryCount + 1}`;
}

export default function App() {
  // Parsing engine settings
  const [engineMode, setEngineMode] = useState<"ai" | "local">("local");
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  // Active manifest data state
  const [activeFileName, setActiveFileName] = useState<string>("");
  const [activeHistoryFilter, setActiveHistoryFilter] = useState<string>("all");
  const [metadata, setMetadata] = useState<ManifestMetadata>({
    route: "",
    date: "",
    tripOrRitNumber: "",
    truck: "",
    driver: "",
    trailer: "",
  });
  const [consignments, setConsignments] = useState<Consignment[]>([]);
  
  // Selection and search states
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingConsignment, setEditingConsignment] = useState<Consignment | null>(null);
  
  // History tracking state
  const [history, setHistory] = useState<ExtractionHistoryEntry[]>([]);
  
  // Notification banner
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  
  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem("manifest_extraction_history");
      if (storedHistory) {
        const parsed = JSON.parse(storedHistory) as ExtractionHistoryEntry[];
        
        let migrated = false;
        const seenIds = new Set<string>();
        const updatedParsed = parsed.map((h, hIdx) => {
          const updatedConsignments = h.consignments.map((c, cIdx) => {
            const isOldOrDuplicate = !c.id || !c.id.startsWith("C-") || seenIds.has(c.id);
            if (isOldOrDuplicate) {
              migrated = true;
              const newId = `C-${Date.now()}-${hIdx}-${cIdx}-${Math.floor(1000 + Math.random() * 9000)}`;
              seenIds.add(newId);
              return { ...c, id: newId };
            }
            seenIds.add(c.id);
            return c;
          });
          return { ...h, consignments: updatedConsignments };
        });

        if (migrated) {
          localStorage.setItem("manifest_extraction_history", JSON.stringify(updatedParsed));
        }

        setHistory(updatedParsed);
        if (updatedParsed.length > 0) {
          const allConsignments = updatedParsed.flatMap(h => h.consignments);
          setConsignments(allConsignments);
          setActiveFileName("All Loaded Trucks");
          setActiveHistoryFilter("all");
        }
      }
    } catch (e) {
      console.error("Failed to load manifest history", e);
    }
  }, []);

  // Save history to localStorage
  const saveHistory = (newHistory: ExtractionHistoryEntry[]) => {
    try {
      setHistory(newHistory);
      localStorage.setItem("manifest_extraction_history", JSON.stringify(newHistory));
    } catch (e) {
      console.error("Failed to persist extraction history", e);
    }
  };

  // Helper trigger notifications
  const triggerNotification = (message: string, type: "success" | "error" | "info" = "success") => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // File processing queue for multiple manifest files
  const processManifestFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setIsUploading(true);
    setUploadError(null);
    setUploadProgress({ current: 0, total: files.length, fileName: files[0].name });

    const results: Array<{ file: File; result: ExtractedManifest }> = [];
    const errors: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress({ current: i, total: files.length, fileName: file.name });

      try {
        let result: ExtractedManifest;

        // Convert file to ArrayBuffer for Local PDF parser
        const arrayBufferPromise = new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(file);
        });

        if (engineMode === "local") {
          const arrayBuffer = await arrayBufferPromise;
          result = await parsePdfLocally(arrayBuffer);
        } else {
          const base64Promise = new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const rawBase64 = reader.result as string;
              // Strip off data url prefix
              const base64Content = rawBase64.substring(rawBase64.indexOf(",") + 1);
              resolve(base64Content);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });

          const fileBase64 = await base64Promise;

          const response = await fetch("/api/parse-pdf", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fileBase64,
              mimeType: file.type || "application/pdf"
            }),
          });

          if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.message || errData.error || "Server processing failed.");
          }

          const resData = await response.json();
          if (resData.success) {
            result = resData.data;
          } else {
            throw new Error("Invalid response form from server");
          }
        }

        results.push({ file, result });
      } catch (err: any) {
        console.error(`Manifest extraction failure for ${file.name}:`, err);
        errors.push(`${file.name}: ${err.message || "Parse failure"}`);
      }
    }

    if (results.length > 0) {
      // Create separate history entries for each successfully extracted file
      const newEntries: ExtractionHistoryEntry[] = results.map(({ file, result }, idx) => {
        const isFilenamePriority = checkIsFileNamePriority(file.name);
        const extractedTruck = parseTruckFromFilename(file.name);
        const port = detectPort(result.metadata.route || "", file.name);
        const truckLabel = suggestTruckLabel(file.name, history.length + idx);
        
        const updatedMetadata: ManifestMetadata = {
          ...result.metadata,
          truck: extractedTruck || result.metadata.truck || "",
          trailer: sanitizeTrailer(result.metadata.trailer || ""),
          isPriority: isFilenamePriority,
          port: port,
          truckLabel: truckLabel
        };

        return {
          id: `HIST-${Date.now()}-${idx}-${Math.floor(Math.random() * 1000)}`,
          fileName: file.name,
          timestamp: new Date().toISOString(),
          method: engineMode,
          metadata: updatedMetadata,
          consignments: result.consignments.map((c, cIdx) => ({
            ...c,
            id: `C-${Date.now()}-${idx}-${cIdx}-${Math.floor(1000 + Math.random() * 9000)}`
          })),
        };
      });

      setHistory(() => {
        const updated = [...newEntries];
        localStorage.setItem("manifest_extraction_history", JSON.stringify(updated));
        
        // Also update the active view with all combined consignments in the history
        setConsignments(updated.flatMap(h => h.consignments));
        return updated;
      });

      // Load all consignments combined so they can select "all" trucks
      setActiveHistoryFilter("all");
      setActiveFileName("All Loaded Trucks");
      setMetadata({
        route: "",
        date: "",
        tripOrRitNumber: "",
        truck: "",
        driver: "",
        trailer: "",
        isPriority: false,
        port: "",
        truckLabel: ""
      });
      setSelectedIds(new Set());

      if (errors.length === 0) {
        triggerNotification(
          `Successfully processed and added ${results.length} customs manifest PDFs!`,
          "success"
        );
      } else {
        triggerNotification(
          `Extracted ${results.length} files successfully. ${errors.length} failed.`,
          "info"
        );
        setUploadError(`Processing issues:\n${errors.join("\n")}`);
      }
    } else {
      setUploadError(`Failed to process document(s):\n${errors.join("\n")}`);
      triggerNotification("All PDF upload/extraction attempts failed.", "error");
    }

    setIsUploading(false);
    setUploadProgress(null);
  };

  // Drag and drop events
  const [dragActive, setDragActive] = useState<boolean>(false);
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const pdfFiles: File[] = [];
      const nonPdfNames: string[] = [];

      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          pdfFiles.push(file);
        } else {
          nonPdfNames.push(file.name);
        }
      }

      if (pdfFiles.length > 0) {
        if (nonPdfNames.length > 0) {
          setUploadError(`Skipped non-PDF files: ${nonPdfNames.join(", ")}`);
        }
        processManifestFiles(pdfFiles);
      } else {
        setUploadError("Invalid file type. Please upload standard PDF documents.");
        triggerNotification("Invalid file format. PDFs only.", "error");
      }
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const pdfFiles: File[] = [];
      for (let i = 0; i < e.target.files.length; i++) {
        const file = e.target.files[i];
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          pdfFiles.push(file);
        }
      }

      if (pdfFiles.length > 0) {
        processManifestFiles(pdfFiles);
      } else {
        setUploadError("No standard PDF files selected.");
        triggerNotification("Please select PDF files.", "error");
      }
    }
  };

  // Filter switching function for different Trucks/Tracks
  const handleTruckFilterChange = (filterId: string) => {
    setActiveHistoryFilter(filterId);
    setSelectedIds(new Set());
    
    if (filterId === "all") {
      const allConsignments = history.flatMap(h => h.consignments);
      setConsignments(allConsignments);
      setActiveFileName("All Loaded Trucks");
      setMetadata({
        route: "",
        date: "",
        tripOrRitNumber: "",
        truck: "",
        driver: "",
        trailer: "",
        isPriority: false,
        port: "",
        truckLabel: ""
      });
    } else {
      const entry = history.find(h => h.id === filterId);
      if (entry) {
        setActiveFileName(entry.fileName);
        setMetadata(entry.metadata);
        setConsignments(entry.consignments);
      }
    }
  };

  // Trigger loading a history log
  const loadHistoryEntry = (entry: ExtractionHistoryEntry) => {
    handleTruckFilterChange(entry.id);
    triggerNotification(`Restored session for manifest: ${entry.fileName}`, "info");
  };

  // Delete a history entry
  const deleteHistoryEntry = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = history.filter(h => h.id !== id);
    saveHistory(updated);
    
    if (activeHistoryFilter === id) {
      handleTruckFilterChange("all");
    } else if (activeHistoryFilter === "all") {
      setConsignments(updated.flatMap(h => h.consignments));
    }
    triggerNotification("History log entry deleted.", "info");
  };

  // Clear all logs
  const clearAllHistory = () => {
    if (window.confirm("Are you sure you want to clear your local database history?")) {
      saveHistory([]);
      setConsignments([]);
      setActiveFileName("");
      setActiveHistoryFilter("all");
      triggerNotification("All extraction history logs cleared.", "info");
    }
  };

  // Edit manifest metadata
  const handleMetadataChange = (key: keyof ManifestMetadata | "isPriority", value: any) => {
    setMetadata(prev => {
      const updatedMeta = { ...prev, [key]: value };
      
      // If we are filtering on a specific history entry, save back to history
      if (activeHistoryFilter !== "all") {
        const updatedHistory = history.map(h => 
          h.id === activeHistoryFilter 
            ? { ...h, metadata: updatedMeta }
            : h
        );
        saveHistory(updatedHistory);
      }
      return updatedMeta;
    });
  };

  // Update a single consignment row
  const saveConsignmentEdits = () => {
    if (!editingConsignment) return;
    setConsignments(prev => {
      const updated = prev.map(c => c.id === editingConsignment.id ? editingConsignment : c);
      
      const updatedHistory = history.map(h => {
        const hasConsignment = h.consignments.some(c => c.id === editingConsignment.id);
        if (hasConsignment) {
          return {
            ...h,
            consignments: h.consignments.map(c => c.id === editingConsignment.id ? editingConsignment : c)
          };
        }
        return h;
      });
      saveHistory(updatedHistory);
      return updated;
    });
    setEditingConsignment(null);
    triggerNotification("Consignment row updated successfully.", "success");
  };

  // Add custom manual consignment row
  const addManualConsignment = () => {
    const newId = `M-${Date.now()}`;
    const newConsignment: Consignment = {
      id: newId,
      loadingDate: metadata.date ? (metadata.date.includes("-") ? metadata.date : "13-05-2026") : "13-05-2026",
      consignor: "New Cargo Sender",
      deliveryDate: metadata.date ? (metadata.date.includes("-") ? metadata.date : "14-05-2026") : "14-05-2026",
      consignee: "New Cargo Receiver Address",
      referenceNumber: `${Math.floor(100000 + Math.random() * 900000)}/01`,
      customsDeclaration: "",
      additionalCode: "",
      who: "",
      status: "",
      t2: "",
      jobNumber: "",
      ens: "",
      readyForHaulier: "",
      notes: ""
    };
    
    setConsignments(prev => [newConsignment, ...prev]);
    
    if (history.length > 0) {
      const targetHistoryIndex = activeHistoryFilter === "all" ? 0 : history.findIndex(h => h.id === activeHistoryFilter);
      const actualIdx = targetHistoryIndex >= 0 ? targetHistoryIndex : 0;
      
      const updatedHistory = history.map((h, index) => 
        index === actualIdx
          ? { ...h, consignments: [newConsignment, ...h.consignments] }
          : h
      );
      saveHistory(updatedHistory);
    }
    
    setEditingConsignment(newConsignment);
    triggerNotification("New editable consignment row added.", "success");
  };

  // Remove elements
  const deleteConsignment = (id: string) => {
    setConsignments(prev => {
      const updated = prev.filter(c => c.id !== id);
      
      const updatedHistory = history.map(h => ({
        ...h,
        consignments: h.consignments.filter(c => c.id !== id)
      }));
      saveHistory(updatedHistory);
      return updated;
    });
    setSelectedIds(prev => {
      const updated = new Set(prev);
      updated.delete(id);
      return updated;
    });
    triggerNotification("Consignment row deleted.", "info");
  };

  // Bulk remove selected elements
  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`Are you sure you want to delete the ${selectedIds.size} selected rows?`)) {
      setConsignments(prev => {
        const updated = prev.filter(c => !selectedIds.has(c.id));
        
        const updatedHistory = history.map(h => ({
          ...h,
          consignments: h.consignments.filter(c => !selectedIds.has(c.id))
        }));
        saveHistory(updatedHistory);
        return updated;
      });
      setSelectedIds(new Set());
      triggerNotification(`Removed selected consignments.`, "info");
    }
  };

  // Row selection toggle handlers
  const toggleRowSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAllRows = () => {
    if (selectedIds.size === filteredConsignments.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredConsignments.map(c => c.id)));
    }
  };

  // Filtering consignments based on search query
  const filteredConsignments = consignments.filter(c => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      c.consignor.toLowerCase().includes(query) ||
      c.consignee.toLowerCase().includes(query) ||
      c.referenceNumber.toLowerCase().includes(query) ||
      (c.customsDeclaration && c.customsDeclaration.toLowerCase().includes(query)) ||
      (c.additionalCode && c.additionalCode.toLowerCase().includes(query)) ||
      c.loadingDate.includes(query) ||
      c.deliveryDate.includes(query)
    );
  });

  // Export functions - Generates high-compatibility spreadsheet format
  const exportToCSV = (format: "csv" | "excel") => {
    if (consignments.length === 0) {
      triggerNotification("No consignment data to export.", "error");
      return;
    }

    const headers = [
      "Priority Level",
      "Manifest Route", 
      "Manifest Date", 
      "Rit/Trip Number", 
      "Truck ID", 
      "Driver Name", 
      "Trailer ID", 
      "Loading Date", 
      "Consignor (Sender)", 
      "Delivery Date", 
      "Consignee (Recipient)", 
      "Reference Number", 
      "Customs Declaration (Red Code)", 
      "Additional Code"
    ];

    const rows = consignments.map(c => {
      const matchingHistory = history.find(h => h.consignments.some(hc => hc.id === c.id));
      const rowMeta = matchingHistory ? matchingHistory.metadata : metadata;
      return [
        rowMeta.isPriority ? "PRIORITY" : "STANDARD",
        rowMeta.route,
        rowMeta.date,
        rowMeta.tripOrRitNumber,
        rowMeta.truck,
        rowMeta.driver,
        rowMeta.trailer,
        c.loadingDate,
        c.consignor,
        c.deliveryDate,
        c.consignee,
        c.referenceNumber,
        c.customsDeclaration || "",
        c.additionalCode || ""
      ];
    });

    let fileContent = "";
    let mimeType = "text/csv;charset=utf-8;";
    let extension = ".csv";

    if (format === "csv") {
      // Create standard escaped CSV string compatible with general software
      const csvContent = [headers, ...rows].map(row => 
        row.map(value => {
          const escaped = String(value).replace(/"/g, '""');
          return `"${escaped}"`;
        }).join(",")
      ).join("\r\n");
      // Add UTF-8 BOM representation so Excel reads international characters perfectly (such as "œ", "ü", etc.)
      fileContent = "\uFEFF" + csvContent;
    } else {
      // Create HTML layout spreadsheet directly readable and editable inside Excel without formatting issues
      mimeType = "application/vnd.ms-excel;charset=utf-8;";
      extension = ".xls";

      let htmlSpreadsheet = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta http-equiv="content-type" content="text/html; charset=UTF-8">
          <style>
            table { border-collapse: collapse; }
            th { background-color: #2D3748; color: #FFFFFF; font-weight: bold; font-family: sans-serif; height: 32px; border: 1px solid #CBD5E0; }
            td { font-family: Arial, sans-serif; font-size: 11pt; border: 1px solid #E2E8F0; padding: 4px; }
            .meta-header { background-color: #EDF2F7; font-weight: bold; }
          </style>
        </head>
        <body>
          <h2>Customs Material Manifest Data Report</h2>
          <table border="1">
            <thead>
              <tr>
                ${headers.map(h => `<th>${h}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  ${row.map(cell => `<td>${cell}</td>`).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </body>
        </html>
      `;
      fileContent = htmlSpreadsheet.trim();
    }

    const blob = new Blob([fileContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    // Create detailed filename
    const cleanFileName = (activeFileName ? activeFileName.replace(/\.[^/.]+$/, "") : "manifest_report") + "_" + (metadata.tripOrRitNumber || "report");
    link.setAttribute("href", url);
    link.setAttribute("download", `${cleanFileName}${extension}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    triggerNotification(`Successfully exported report as ${extension.toUpperCase()}!`, "success");
  };

  // Export to Master Haulier template spreadsheet
  const exportToMasterSpreadsheet = (format: "csv" | "excel", scope: "active" | "all") => {
    let manifestsToExport: { metadata: ManifestMetadata; consignments: Consignment[]; fileName: string }[] = [];

    if (scope === "active") {
      if (consignments.length === 0) {
        triggerNotification("No consignment data to export.", "error");
        return;
      }
      
      if (activeHistoryFilter === "all") {
        // Since active view contains multiple files consolidated, group consignments back by their parent file history metadata
        const groupedMap = new Map<string, { metadata: ManifestMetadata; consignments: Consignment[]; fileName: string }>();
        consignments.forEach(c => {
          const matchingHistory = history.find(h => h.consignments.some(hc => hc.id === c.id));
          const hId = matchingHistory ? matchingHistory.id : "manual";
          const hMeta = matchingHistory ? matchingHistory.metadata : metadata;
          const hName = matchingHistory ? matchingHistory.fileName : (activeFileName || "active");
          
          if (!groupedMap.has(hId)) {
            groupedMap.set(hId, { metadata: hMeta, consignments: [], fileName: hName });
          }
          groupedMap.get(hId)!.consignments.push(c);
        });
        
        manifestsToExport = Array.from(groupedMap.values());
      } else {
        manifestsToExport.push({ metadata, consignments, fileName: activeFileName || "active" });
      }
    } else {
      if (history.length === 0) {
        if (consignments.length > 0) {
          manifestsToExport.push({ metadata, consignments, fileName: activeFileName || "active" });
        } else {
          triggerNotification("No loaded trucks or consignments to export.", "error");
          return;
        }
      } else {
        const sortedHistory = [...history].reverse(); // oldest first, so newest additions are appended
        manifestsToExport = sortedHistory.map(h => ({
          metadata: h.metadata,
          consignments: h.consignments,
          fileName: h.fileName
        }));
      }
    }

    const headers = [
      "Truck",
      "Priority",
      "Port",
      "Truck Number",
      "Trailer Number",
      "CMR",
      "Who",
      "Status",
      "T2",
      "Job Number",
      "MRN",
      "IPAFFs",
      "ENS",
      "Ready for Haulier",
      "Notes"
    ];

    const rows: string[][] = [];
    manifestsToExport.forEach(manifest => {
      const meta = manifest.metadata;
      manifest.consignments.forEach(c => {
        rows.push([
          meta.truckLabel || "",          // Truck Group Label / Name
          meta.isPriority ? "Prio" : "",  // Priority
          meta.port || "Immingham",       // Port (default if not specified)
          meta.truck || "",               // Truck Number
          meta.trailer || "",             // Trailer Number
          c.referenceNumber || "",        // CMR (or referenceNumber)
          c.who || "",                    // Who (filled from manual edit or system)
          c.status || "",                 // Status
          c.t2 || "",                     // T2
          c.jobNumber || "",              // Job Number
          c.customsDeclaration || "",     // MRN
          c.additionalCode || "",         // IPAFFs
          c.ens || "",                    // ENS
          c.readyForHaulier || "",        // Ready for Haulier
          c.notes || ""                   // Notes
        ]);
      });
    });

    let fileContent = "";
    let mimeType = "text/csv;charset=utf-8;";
    let extension = ".csv";

    if (format === "csv") {
      const csvContent = [headers, ...rows].map(row => 
        row.map(value => {
          const escaped = String(value).replace(/"/g, '""');
          return `"${escaped}"`;
        }).join(",")
      ).join("\r\n");
      fileContent = "\uFEFF" + csvContent;
    } else {
      mimeType = "application/vnd.ms-excel;charset=utf-8;";
      extension = ".xls";

      const htmlSpreadsheet = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta http-equiv="content-type" content="text/html; charset=UTF-8">
          <style>
            table { border-collapse: collapse; }
            th { 
              background-color: #1E3A8A; 
              color: #FFFFFF; 
              font-weight: bold; 
              font-family: 'Segoe UI', Arial, sans-serif; 
              font-size: 10pt; 
              height: 32px; 
              border: 1px solid #94A3B8; 
            }
            td { 
              font-family: Arial, sans-serif; 
              font-size: 9.5pt; 
              border: 1px solid #CBD5E2; 
              padding: 6px 12px; 
            }
            .prio-row { 
              background-color: #FEF3C7; 
            }
            .prio-badge { 
              color: #92400E; 
              font-weight: bold; 
            }
          </style>
        </head>
        <body>
          <table border="1">
            <thead>
              <tr>
                ${headers.map(h => `<th>${h}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => {
                const isPrio = row[1] === "Prio";
                const rowClassAttr = isPrio ? ' class="prio-row"' : '';
                return `
                <tr${rowClassAttr}>
                  <td>${row[0]}</td>
                  <td class="prio-badge">${row[1]}</td>
                  <td>${row[2]}</td>
                  <td>${row[3]}</td>
                  <td>${row[4]}</td>
                  <td>${row[5]}</td>
                  <td>${row[6]}</td>
                  <td>${row[7]}</td>
                  <td>${row[8]}</td>
                  <td>${row[9]}</td>
                  <td>${row[10]}</td>
                  <td>${row[11]}</td>
                  <td>${row[12]}</td>
                  <td>${row[13]}</td>
                  <td>${row[14]}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </body>
        </html>
      `;
      fileContent = htmlSpreadsheet.trim();
    }

    const blob = new Blob([fileContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    const cleanFileName = scope === "all" 
      ? "Master_Haulier_Manifest_All_Trucks" 
      : `Master_Haulier_Manifest_${(metadata.truckLabel || "Truck").replace(/\s+/g, "_")}`;
      
    link.setAttribute("href", url);
    link.setAttribute("download", `${cleanFileName}${extension}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    triggerNotification(`Exported Master Spreadsheet successfully (${scope === "all" ? "Bulk History" : "Current active"})`, "success");
  };

  // Fill in sample data instantly so user can play around immediately
  const loadMockSampleData = () => {
    const demoFileNameStandard = "Sample_Customs_Immingham_Manifest_436673.pdf";
    const demoFileNamePriority = "PRIO_Urgent_Customs_Material_Manifest_436690.pdf";

    const standardMeta: ManifestMetadata = {
      route: "11. Immingham",
      date: "woensdag 13 mei 2026",
      tripOrRitNumber: "436673",
      truck: "1083 - 01-BJS-1",
      driver: "Jaap van den Berg",
      trailer: "7107 - OR-84-XX- VDL",
      isPriority: false,
      truckLabel: "Truck 11",
      port: "Immingham"
    };

    const priorityMeta: ManifestMetadata = {
      route: "11. Immingham (Urgent)",
      date: "donderdag 14 mei 2026",
      tripOrRitNumber: "436690",
      truck: "36-BRL-5",
      driver: "William de Ruiter",
      trailer: "9981 - OR-88-ZZ- KPN",
      isPriority: true,
      truckLabel: "Truck 3a",
      port: "Felixstowe"
    };

    const consignmentsStandard: Consignment[] = [
      {
        id: "954303/33",
        loadingDate: "13-05-2026",
        consignor: "Impulse Plants - Wijk en Aalburg",
        deliveryDate: "14-05-2026",
        consignee: "Williamson Design Florist Ltd., Uphall",
        referenceNumber: "954303/33",
        customsDeclaration: "",
        additionalCode: "",
        who: "John B.",
        status: "Completed",
        t2: "T2",
        jobNumber: "JOB-77443",
        ens: "ENS-2026-9",
        readyForHaulier: "Yes",
        notes: "Direct floristry drops"
      },
      {
        id: "954582/3",
        loadingDate: "13-05-2026",
        consignor: "Van der Plas Flowers and Plants B.V. - RIJNSBURG",
        deliveryDate: "14-05-2026",
        consignee: "Johnson & Scott Co. Ltd., GLASGOW",
        referenceNumber: "954582/3",
        customsDeclaration: "IR-2605-05532",
        additionalCode: "+5",
        who: "Sarah M.",
        status: "Pending Check",
        t2: "N/A",
        jobNumber: "JOB-77445",
        ens: "ENS-22910",
        readyForHaulier: "No",
        notes: "Needs phytosanitary inspection"
      },
      {
        id: "954391/1",
        loadingDate: "13-05-2026",
        consignor: "Larosa Export BV. - Aalsmeer",
        deliveryDate: "14-05-2026",
        consignee: "Rouken Glenn Garden Centre, GIFFNOCK",
        referenceNumber: "954391/1",
        customsDeclaration: "IR-2605-05526",
        additionalCode: "",
        who: "John B.",
        status: "Completed",
        t2: "T1",
        jobNumber: "JOB-77449",
        ens: "ENS-2026-11",
        readyForHaulier: "Yes",
        notes: "Pre-cleared"
      },
      {
        id: "954303/32",
        loadingDate: "13-05-2026",
        consignor: "Impulse Plants - Wijk en Aalburg",
        deliveryDate: "14-05-2026",
        consignee: "Silverbirch Garden Centre, Crossford",
        referenceNumber: "954303/32",
        customsDeclaration: "",
        additionalCode: "",
        who: "Unassigned",
        status: "Review",
        t2: "T2",
        jobNumber: "",
        ens: "",
        readyForHaulier: "No",
        notes: "Awaiting final invoice copy"
      }
    ];

    const consignmentsPriority: Consignment[] = [
      {
        id: "954600/12",
        loadingDate: "14-05-2026",
        consignor: "Groot-Ammers Flora Trade",
        deliveryDate: "15-05-2026",
        consignee: "Highland Flower Distributors, Inverness",
        referenceNumber: "954600/12",
        customsDeclaration: "IR-2605-09944",
        additionalCode: "+9",
        who: "William R.",
        status: "URGENT Priority",
        t2: "T2",
        jobNumber: "JOB-PRIO-01",
        ens: "ENS-PRIO-12",
        readyForHaulier: "Yes",
        notes: "Urgent dispatch scheduled for early morning."
      }
    ];

    const mappedPriorityConsignments = consignmentsPriority.map((c, idx) => ({
      ...c,
      id: `C-${Date.now()}-prio-${idx}-${Math.floor(1000 + Math.random() * 9000)}`
    }));

    const mappedStandardConsignments = consignmentsStandard.map((c, idx) => ({
      ...c,
      id: `C-${Date.now()}-std-${idx}-${Math.floor(1000 + Math.random() * 9000)}`
    }));

    // Update active view with standard manifest
    setActiveFileName(demoFileNameStandard);
    setMetadata(standardMeta);
    setConsignments(mappedStandardConsignments);
    setSelectedIds(new Set());

    // Inject standard and priority manifests mock into history list
    const testStandardId = `HIST-${Date.now()}-demostd`;
    const testPriorityId = `HIST-${Date.now()}-demoprio`;

    const newEntries: ExtractionHistoryEntry[] = [
      {
        id: testPriorityId,
        fileName: demoFileNamePriority,
        timestamp: new Date().toISOString(),
        method: "local",
        metadata: priorityMeta,
        consignments: mappedPriorityConsignments
      },
      {
        id: testStandardId,
        fileName: demoFileNameStandard,
        timestamp: new Date().toISOString(),
        method: "local",
        metadata: standardMeta,
        consignments: mappedStandardConsignments
      }
    ];

    setHistory(prevHistory => {
      const remains = prevHistory.filter(h => h.fileName !== demoFileNameStandard && h.fileName !== demoFileNamePriority);
      const updated = [...newEntries, ...remains];
      localStorage.setItem("manifest_extraction_history", JSON.stringify(updated));
      return updated;
    });

    triggerNotification("Loaded standard & priority customs Demo data.", "info");
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#f3f3f3] text-slate-800 font-sans overflow-hidden selection:bg-blue-500/20">
      
      {/* Top Banner Notification Alert */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -45, scale: 0.95 }}
            animate={{ opacity: 1, y: 16, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-0 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border px-6 py-3 shadow-xl backdrop-blur-md ${
              notification.type === "success" 
                ? "border-green-100 bg-green-50/95 text-green-900" 
                : notification.type === "error" 
                ? "border-red-100 bg-red-50/95 text-red-900" 
                : "border-slate-800 bg-slate-900 text-white"
            }`}
          >
            {notification.type === "success" && <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />}
            {notification.type === "error" && <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />}
            {notification.type === "info" && <Layers className="h-5 w-5 text-blue-500 shrink-0" />}
            <span className="text-sm font-medium">{notification.message}</span>
            <button 
              onClick={() => setNotification(null)}
              className="ml-2 rounded-full p-1 text-slate-400 hover:bg-slate-200/50 hover:text-slate-600 focus:outline-none"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Windows 11 Style Header */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-10 shadow-xs">
        <div className="flex items-center space-x-3.5">
          <div className="w-8 h-8 bg-white border border-slate-100 rounded flex items-center justify-center overflow-hidden p-0.5 select-none shadow-xs">
            <img 
              src="https://iclhub.iclgo.com/images/logo1.png" 
              alt="ICL Logo" 
              referrerPolicy="no-referrer"
              className="max-w-full max-h-full object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const parent = e.currentTarget.parentElement;
                if (parent) {
                  parent.className = "w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-[10px] select-none";
                  parent.textContent = "ICL";
                }
              }}
            />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <span>ICL -VDL truck tracking </span> 
              <span className="font-normal text-slate-400 text-xs">v1.2.0</span>
            </h1>
            <p className="text-[10px] text-slate-400 pointer-events-none">Extract truck details into structured spreadsheets</p>
          </div>
        </div>
        

      </header>      {/* Central multi-column viewport workspace */}
      <main className="flex-1 flex overflow-hidden p-6 gap-6 min-h-0">
        
        {/* Left Sidebar: Upload, Control Panels, and session history */}
        <aside className="w-80 flex flex-col gap-5 shrink-0 overflow-y-auto pr-1 select-none">
          
          {/* Document Dotted Upload Area */}
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={triggerFileSelect}
            className={`bg-white border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center space-y-3 cursor-pointer transition-all ${
              dragActive 
                ? "border-blue-500 bg-blue-50/15 scale-[0.98]" 
                : isUploading 
                ? "border-slate-200 bg-slate-50 cursor-not-allowed" 
                : "border-slate-300 hover:border-blue-500 hover:bg-blue-50/5 shadow-xs"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={handleFileChange}
              disabled={isUploading}
            />

            {isUploading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                <div>
                  <p className="text-xs font-semibold text-slate-700">
                    {uploadProgress ? `Processing ${uploadProgress.current + 1} of ${uploadProgress.total}...` : "Parsing Manifest File..."}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1 truncate max-w-[180px] font-medium block mx-auto">
                    {uploadProgress ? uploadProgress.fileName : (engineMode === "ai" ? "Gemini doing layout analysis" : "Mapping local PDF grid lines")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center space-y-2">
                <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-700">Drag & drop PDFs here</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">or click to upload multiple PDFs</p>
                </div>
              </div>
            )}
            
            {activeFileName && !isUploading && (
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-blue-50 text-blue-800 text-[10px] font-semibold max-w-full truncate border border-blue-100">
                <FileText className="h-3 w-3 shrink-0 text-blue-600" />
                <span className="truncate">{activeFileName}</span>
              </div>
            )}
          </div>

          {uploadError && (
            <div className="rounded-lg bg-red-50 p-3 text-red-900 border border-red-100 flex items-start gap-2 text-xs">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <p className="font-medium leading-relaxed">{uploadError}</p>
            </div>
          )}

          {/* Engine Selection Block */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col space-y-2">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Extraction mode</h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setEngineMode("local")}
                className={`py-2 px-2.5 rounded-lg border text-xs font-semibold text-center transition-all flex items-center justify-center gap-1.5 ${
                  engineMode === "local"
                    ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <Cpu className="h-3.5 w-3.5" />
                <span>Default mode</span>
              </button>
              <button
                onClick={() => setEngineMode("ai")}
                className={`py-2 px-2.5 rounded-lg border text-xs font-semibold text-center transition-all flex items-center justify-center gap-1.5 ${
                  engineMode === "ai"
                    ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>AI Mode</span>
              </button>
            </div>
          </div>

          {/* Copyright Section */}
          <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-medium">
            <span>Copyright © {new Date().getFullYear()} ICL IT</span>
            <span>v1.2.0</span>
          </div>

        </aside>

        {/* Right view panel: Document Metadata Header (Editable) & Consignments Data Table */}
        <section className="flex-1 flex flex-col gap-5 overflow-hidden min-h-0">
            
            {/* Manifest Document Header Fields (Editable) */}
            {consignments.length > 0 && (
              activeHistoryFilter === "all" ? (
                <div className="bg-gradient-to-r from-blue-50/70 to-indigo-50/40 rounded-xl border border-blue-100 p-4 shadow-3xs shrink-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600/10 rounded-lg flex items-center justify-center text-blue-600 shrink-0">
                      <Truck className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-800">Consolidated Trucks View</h3>
                      <p className="text-[10px] text-slate-500 mt-0.5">Showing compiled consignments from all uploaded files. Select a specific truck inside the table toolbar dropdown to edit document-level parameters like Custom Route, Driver, or Registration Plate.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs shrink-0">
                  <div className="flex items-center gap-2 mb-3.5 select-none">
                    <Briefcase className="h-4 w-4 text-slate-400" />
                    <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Document Metadata Fields (Active Ticket)</h2>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5 select-none">
                        <MapPin className="h-3 w-3 text-blue-500 shrink-0" /> Customs Route / Station
                      </label>
                      <input
                        type="text"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                        value={metadata.route}
                        onChange={(e) => handleMetadataChange("route", e.target.value)}
                        placeholder="e.g. 11. Immingham"
                      />
                    </div>

                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5 select-none">
                        <Layers className="h-3 w-3 text-blue-500 shrink-0" /> Rit / Trip ID
                      </label>
                      <input
                        type="text"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-mono font-bold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                        value={metadata.tripOrRitNumber}
                        onChange={(e) => handleMetadataChange("tripOrRitNumber", e.target.value)}
                        placeholder="e.g. 436673"
                      />
                    </div>

                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5 select-none">
                        <Calendar className="h-3 w-3 text-blue-500 shrink-0" /> Route Date
                      </label>
                      <input
                        type="text"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                        value={metadata.date}
                        onChange={(e) => handleMetadataChange("date", e.target.value)}
                        placeholder="e.g. woensdag 13 mei 2026"
                      />
                    </div>

                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5 select-none">
                        <Truck className="h-3 w-3 text-blue-500 shrink-0" /> Truck Registration
                      </label>
                      <input
                        type="text"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-mono font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                        value={metadata.truck}
                        onChange={(e) => handleMetadataChange("truck", e.target.value)}
                        placeholder="e.g. 1083 - 01-BJS-1"
                      />
                    </div>

                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5 select-none">
                        <User className="h-3 w-3 text-blue-500 shrink-0" /> Assigned Driver
                      </label>
                      <input
                        type="text"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                        value={metadata.driver}
                        onChange={(e) => handleMetadataChange("driver", e.target.value)}
                        placeholder="e.g. Jaap van den Berg"
                      />
                    </div>

                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5 select-none">
                        <Truck className="h-3 w-3 text-blue-500 shrink-0" /> Trailer Block
                      </label>
                      <input
                        type="text"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                        value={metadata.trailer}
                        onChange={(e) => handleMetadataChange("trailer", e.target.value)}
                        placeholder="e.g. 7107 - OR-84-XX- VDL"
                      />
                    </div>

                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5 select-none">
                        <Layers className="h-3 w-3 text-blue-500 shrink-0" /> Truck Group Index (c)
                      </label>
                      <input
                        type="text"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                        value={metadata.truckLabel || ""}
                        onChange={(e) => handleMetadataChange("truckLabel", e.target.value)}
                        placeholder="e.g. Truck 11"
                      />
                    </div>

                    <div>
                      <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1.5 select-none">
                        <MapPin className="h-3 w-3 text-blue-500 shrink-0" /> Port Station
                      </label>
                      <select
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none transition-all cursor-pointer bg-no-repeat bg-right"
                        value={metadata.port || "Immingham"}
                        onChange={(e) => handleMetadataChange("port", e.target.value)}
                      >
                        <option value="Immingham">Immingham</option>
                        <option value="Harwich">Harwich</option>
                        <option value="Felixstowe">Felixstowe</option>
                        <option value="Folkestone">Folkestone</option>
                      </select>
                    </div>

                    <div className="flex items-center pt-5">
                      <label className="flex items-center space-x-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500 cursor-pointer"
                          checked={!!metadata.isPriority}
                          onChange={(e) => handleMetadataChange("isPriority", e.target.checked)}
                        />
                        <span className="text-xs font-bold text-slate-750 flex items-center gap-1.5 pb-0.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200 shadow-3xs">
                            ⚡ Priority Manifest Cargo
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )
            )}
                        {/* Consignments Detailed Table List Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex-1 flex flex-col min-h-0">
              
              {/* Table Utility Controls Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-white px-5 py-3 shrink-0 select-none">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-slate-800">Consignments Record Set</h3>
                    <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-800">
                      {filteredConsignments.length} rows {filteredConsignments.length !== consignments.length ? `(filtered from ${consignments.length})` : ""}
                    </span>
                  </div>
                  
                  {history.length > 0 && (
                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/80 rounded-lg p-1 shrink-0">
                      <span className="text-[9px] font-bold text-slate-400 px-1.5 uppercase tracking-wider font-mono select-none">
                        Active Truck:
                      </span>
                      <select
                        value={activeHistoryFilter}
                        onChange={(e) => handleTruckFilterChange(e.target.value)}
                        className="bg-white border border-slate-200 text-[11px] font-bold text-slate-700 px-2 py-0.5 rounded cursor-pointer focus:outline-none focus:border-blue-500 hover:border-slate-300 transition-colors"
                      >
                        <option value="all">🚚 All Consolidated Trucks ({history.length})</option>
                        {history.map((h) => (
                          <option key={h.id} value={h.id}>
                            📦 {h.metadata.truckLabel || h.metadata.truck || "Unlabeled"} ({h.metadata.truck || h.fileName.slice(0, 16)})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Search query field */}
                  <div className="relative">
                    <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      className="rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1 text-xs focus:border-blue-500 focus:bg-white focus:outline-none transition-all w-[180px] sm:w-[220px]"
                      placeholder="Search parties, codes or dates..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      disabled={consignments.length === 0}
                    />
                  </div>

                  {consignments.length > 0 && <div className="h-4 w-px bg-slate-200" />}

                  {consignments.length > 0 && (
                    <button
                      onClick={addManualConsignment}
                      className="flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 text-xs font-semibold transition-all shadow-xs"
                    >
                      <Plus className="h-3.5 w-3.5" /> <span>Add Consignment</span>
                    </button>
                  )}

                  {/* Bulk delete action trigger */}
                  {selectedIds.size > 0 && (
                    <button
                      onClick={deleteSelected}
                      className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 px-2.5 py-1 text-xs font-semibold transition-all"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> <span>Delete ({selectedIds.size})</span>
                    </button>
                  )}

                  {/* Export actions */}
                  {consignments.length > 0 && (
                    <button
                      onClick={() => exportToMasterSpreadsheet("excel", "all")}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-semibold transition-all shadow-xs shrink-0"
                      title="Download Master Spreadsheet containing all loaded sheets/trucks"
                      id="btn-bulk-download"
                    >
                      <FileDown className="h-4 w-4" />
                      <span>Bulk Download</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Data Table Core Frame - Scrollable */}
              <div className="flex-1 overflow-auto min-h-0">
                <table className="w-full text-left border-collapse min-w-[2100px] relative">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[9px] font-bold uppercase tracking-wider text-slate-500 sticky top-0 z-10">
                      <th className="px-5 py-2.5 w-10 text-center">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                          checked={consignments.length > 0 && selectedIds.size === filteredConsignments.length}
                          onChange={toggleAllRows}
                          disabled={consignments.length === 0}
                        />
                      </th>
                      <th className="px-4 py-2.5 w-[120px]">Truck</th>
                      <th className="px-4 py-2.5 w-[85px] text-center">Priority</th>
                      <th className="px-4 py-2.5 w-[120px]">Port</th>
                      <th className="px-4 py-2.5 w-[140px]">Truck Number</th>
                      <th className="px-4 py-2.5 w-[160px]">Trailer Number</th>
                      <th className="px-4 py-2.5 w-[120px]">CMR</th>
                      <th className="px-4 py-2.5 w-[120px]">Who</th>
                      <th className="px-4 py-2.5 w-[130px]">Status</th>
                      <th className="px-4 py-2.5 w-[80px]">T2</th>
                      <th className="px-4 py-2.5 w-[130px]">Job Number</th>
                      <th className="px-4 py-2.5 w-[140px]">MRN</th>
                      <th className="px-4 py-2.5 w-[120px]">IPAFFs</th>
                      <th className="px-4 py-2.5 w-[120px]">ENS</th>
                      <th className="px-4 py-2.5 w-[145px]">Ready for Haulier</th>
                      <th className="px-4 py-2.5 min-w-[250px]">Notes</th>
                      <th className="px-5 py-2.5 w-[110px] text-right">Actions</th>
                    </tr>
                  </thead>
                  
                  <tbody className="divide-y divide-slate-100">
                    {consignments.length === 0 ? (
                      <tr>
                        <td colSpan={17} className="px-6 py-20 text-center text-slate-400">
                          <div className="flex flex-col items-center justify-center gap-3 max-w-md mx-auto">
                            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                              <Layers className="h-6 w-6 stroke-[1.5]" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-700">No consignment records loaded</p>
                              <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                                Upload  PDF files  in the Left Sidebar or browse local files to extract consignment details.
                              </p>
                              <div className="mt-4 flex gap-2 justify-center">
                                <button
                                  onClick={triggerFileSelect}
                                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors shadow-sm"
                                >
                                  Browse PDFs
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : filteredConsignments.length === 0 ? (
                      <tr>
                        <td colSpan={17} className="px-6 py-16 text-center text-slate-400">
                          <p className="text-xs font-bold text-slate-700">No matching records found.</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">Please check your spelling or clear the current active search filter.</p>
                        </td>
                      </tr>
                    ) : (
                      filteredConsignments.map((item, index) => {
                        const isRowSelected = selectedIds.has(item.id);
                        const rowHistory = history.find(h => h.consignments.some(c => c.id === item.id));
                        const rowMeta = rowHistory ? rowHistory.metadata : metadata;
                        return (
                          <tr 
                            key={item.id}
                            className={`hover:bg-blue-50/15 group text-xs transition-colors ${
                              isRowSelected ? "bg-blue-50/10" : ""
                            }`}
                          >
                            <td className="px-5 py-3 text-center">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                                checked={isRowSelected}
                                onChange={() => toggleRowSelect(item.id)}
                              />
                            </td>
                            
                            {/* 1. Truck (Group Index) */}
                            <td className="px-4 py-3 font-semibold text-slate-700 whitespace-nowrap">
                              {rowMeta.truckLabel || `Truck ${index + 1}`}
                            </td>

                            {/* 2. Priority */}
                            <td className="px-4 py-3 text-center">
                              {rowMeta.isPriority ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                  Prio
                                </span>
                              ) : (
                                <span className="text-slate-400 italic font-normal text-[10px]">-</span>
                              )}
                            </td>

                            {/* 3. Port */}
                            <td className="px-4 py-3 font-medium text-slate-700 whitespace-nowrap">
                              {rowMeta.port || "Immingham"}
                            </td>

                            {/* 4. Truck Number */}
                            <td className="px-4 py-3 font-mono font-semibold text-slate-700 whitespace-white space-nowrap">
                              {rowMeta.truck || <span className="text-slate-300 italic text-[10px]">N/A</span>}
                            </td>

                            {/* 5. Trailer Number */}
                            <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                              {rowMeta.trailer || <span className="text-slate-300 italic text-[10px]">N/A</span>}
                            </td>

                            {/* 6. CMR */}
                            <td className="px-4 py-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                              {item.referenceNumber || "N/A"}
                            </td>

                            {/* 7. Who */}
                            <td className="px-4 py-3 text-slate-700 whitespace-nowrap font-medium">
                              {item.who || <span className="text-slate-300 italic text-[10px]">-</span>}
                            </td>

                            {/* 8. Status */}
                            <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                              {item.status ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">
                                  {item.status}
                                </span>
                              ) : (
                                <span className="text-slate-300 italic text-[10px]">-</span>
                              )}
                            </td>

                            {/* 9. T2 */}
                            <td className="px-4 py-3 font-semibold text-slate-700 text-center whitespace-nowrap">
                              {item.t2 || <span className="text-slate-300 italic text-[10px]">-</span>}
                            </td>

                            {/* 10. Job Number */}
                            <td className="px-4 py-3 font-mono font-medium text-slate-700 whitespace-nowrap">
                              {item.jobNumber || <span className="text-slate-300 italic text-[10px]">-</span>}
                            </td>

                            {/* 11. MRN */}
                            <td className="px-4 py-3 font-mono font-bold text-red-700 whitespace-nowrap">
                              {item.customsDeclaration || <span className="text-slate-300 italic text-[10px]">-</span>}
                            </td>

                            {/* 12. IPAFFs */}
                            <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
                              {item.additionalCode || <span className="text-slate-300 italic text-[10px]">-</span>}
                            </td>

                            {/* 13. ENS */}
                            <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
                              {item.ens || <span className="text-slate-300 italic text-[10px]">-</span>}
                            </td>

                            {/* 14. Ready for Haulier */}
                            <td className="px-4 py-3">
                              {item.readyForHaulier ? (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                                  item.readyForHaulier.toLowerCase() === 'yes' || item.readyForHaulier.toLowerCase() === 'ready'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-250'
                                    : 'bg-slate-50 text-slate-600 border-slate-200'
                                }`}>
                                  {item.readyForHaulier}
                                </span>
                              ) : (
                                <span className="text-slate-300 italic text-[10px]">-</span>
                              )}
                            </td>

                            {/* 15. Notes */}
                            <td className="px-4 py-3 text-slate-700 max-w-[320px]">
                              <div className="flex flex-col gap-0.5">
                                {item.notes && <div className="font-bold text-slate-800">{item.notes}</div>}
                                <div className="text-[10px] text-slate-400 truncate font-medium">
                                  Route: {item.consignor} → {item.consignee}
                                </div>
                              </div>
                            </td>

                            <td className="px-5 py-3 text-right">
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={() => setEditingConsignment(item)}
                                  className="rounded p-1.5 hover:bg-slate-100 text-slate-500 hover:text-blue-600 transition-colors"
                                  title="Edit Row"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => deleteConsignment(item.id)}
                                  className="rounded p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                                  title="Delete Row"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            
          </section>
      </main>

      {/* Slideout Edit Block / Dialog Modal */}
      <AnimatePresence>
        {editingConsignment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Overlay backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingConsignment(null)}
              className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
            />
                   {/* Modal Body Container */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              className="relative w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-3">
                <div className="flex items-center gap-2">
                  <Edit3 className="h-4 w-4 text-blue-600" />
                  <h3 className="text-xs font-bold text-slate-800">Edit Consignment Entry</h3>
                </div>
                <button
                  onClick={() => setEditingConsignment(null)}
                  className="rounded-full p-1 text-slate-400 hover:bg-slate-200/50 hover:text-slate-700 transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Loading Date</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                      value={editingConsignment.loadingDate}
                      onChange={(e) => setEditingConsignment({ ...editingConsignment, loadingDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Delivery Date</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                      value={editingConsignment.deliveryDate}
                      onChange={(e) => setEditingConsignment({ ...editingConsignment, deliveryDate: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Consignor (Sender & Location)</label>
                  <textarea
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                    value={editingConsignment.consignor}
                    onChange={(e) => setEditingConsignment({ ...editingConsignment, consignor: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Consignee (Recipient & Address)</label>
                  <textarea
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                    value={editingConsignment.consignee}
                    onChange={(e) => setEditingConsignment({ ...editingConsignment, consignee: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">CMR (Reference)</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-mono font-semibold text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                      value={editingConsignment.referenceNumber}
                      onChange={(e) => setEditingConsignment({ ...editingConsignment, referenceNumber: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">MRN (Customs Dec)</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-mono font-semibold text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                      value={editingConsignment.customsDeclaration || ""}
                      onChange={(e) => setEditingConsignment({ ...editingConsignment, customsDeclaration: e.target.value })}
                      placeholder="e.g. IR-2605-05532"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">IPAFFs Code</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-mono font-semibold text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                      value={editingConsignment.additionalCode || ""}
                      onChange={(e) => setEditingConsignment({ ...editingConsignment, additionalCode: e.target.value })}
                      placeholder="e.g. +5"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">Who (Broker/Contact)</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                      value={editingConsignment.who || ""}
                      onChange={(e) => setEditingConsignment({ ...editingConsignment, who: e.target.value })}
                      placeholder="e.g. William"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">Status</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                      value={editingConsignment.status || ""}
                      onChange={(e) => setEditingConsignment({ ...editingConsignment, status: e.target.value })}
                      placeholder="e.g. Completed"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">T2 Status</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                      value={editingConsignment.t2 || ""}
                      onChange={(e) => setEditingConsignment({ ...editingConsignment, t2: e.target.value })}
                      placeholder="e.g. T2"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">Job Number</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                      value={editingConsignment.jobNumber || ""}
                      onChange={(e) => setEditingConsignment({ ...editingConsignment, jobNumber: e.target.value })}
                      placeholder="e.g. JOB-77443"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">ENS ID</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                      value={editingConsignment.ens || ""}
                      onChange={(e) => setEditingConsignment({ ...editingConsignment, ens: e.target.value })}
                      placeholder="e.g. ENS-2026-9"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">Ready for Haulier</label>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all cursor-pointer"
                      value={editingConsignment.readyForHaulier || ""}
                      onChange={(e) => setEditingConsignment({ ...editingConsignment, readyForHaulier: e.target.value })}
                    >
                      <option value="">- Select -</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                      <option value="Pending">Pending</option>
                      <option value="Ready">Ready</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">Custom Notes</label>
                  <textarea
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                    value={editingConsignment.notes || ""}
                    onChange={(e) => setEditingConsignment({ ...editingConsignment, notes: e.target.value })}
                    placeholder="Add operational notes or details..."
                  />
                </div>
              </div>

              <div className="flex py-3 px-5 bg-slate-50 border-t border-slate-100 justify-end gap-2 text-xs">
                <button
                  onClick={() => setEditingConsignment(null)}
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-100 px-3 py-1.5 font-bold text-slate-600 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={saveConsignmentEdits}
                  className="rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-1.5 font-bold text-white shadow-xs transition"
                >
                  Save Changes
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
