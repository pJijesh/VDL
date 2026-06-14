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

export interface ExtractionHistoryEntry {
  id: string;
  fileName: string;
  timestamp: string;
  method: "ai" | "local";
  metadata: ManifestMetadata;
  consignments: Consignment[];
}
