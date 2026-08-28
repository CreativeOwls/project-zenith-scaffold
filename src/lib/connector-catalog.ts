// Client-safe catalog of tool ids shared by the agent hub, node canvas and connectors page.

export type ToolId = "gmail" | "google_slides" | "fhir" | "reddit" | "firecrawl";

export type ToolCatalogEntry = {
  id: ToolId;
  label: string;
  kind: "native" | "custom";
  description: string;
  actions: string[];
};

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    id: "gmail",
    label: "Gmail",
    kind: "native",
    description: "Read and send email from the connected Google account.",
    actions: ["gmail_search", "gmail_read_message", "gmail_send"],
  },
  {
    id: "google_slides",
    label: "Google Slides",
    kind: "native",
    description: "Create and read Google Slides presentations.",
    actions: ["slides_create", "slides_read", "slides_add_slide"],
  },
  {
    id: "fhir",
    label: "FHIR",
    kind: "custom",
    description: "Read-only FHIR R4 access to patients, appointments, medications and observations.",
    actions: [
      "fhir_search_patient",
      "fhir_get_patient",
      "fhir_get_appointments",
      "fhir_get_medications",
      "fhir_get_observations",
    ],
  },
  {
    id: "reddit",
    label: "Reddit",
    kind: "custom",
    description: "Search subreddits, read top posts and post comments.",
    actions: ["reddit_search_subreddit", "reddit_get_top_posts", "reddit_get_post_comments"],
  },
  {
    id: "firecrawl",
    label: "Firecrawl",
    kind: "native",
    description: "Scrape a page, search the web, map a site's URLs or crawl a whole site into clean markdown.",
    actions: ["firecrawl_scrape", "firecrawl_search", "firecrawl_map", "firecrawl_crawl"],
  },
];

export const ALL_TOOL_IDS: ToolId[] = TOOL_CATALOG.map((t) => t.id);

export function toolLabel(id: string): string {
  return TOOL_CATALOG.find((t) => t.id === id)?.label ?? id;
}
