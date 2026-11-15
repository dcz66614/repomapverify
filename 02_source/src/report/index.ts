/**
 * Report layer (T009; PROJECT_BOOK §6.3, §7).
 * JSON report model + single-file offline HTML renderer.
 */
export { buildFullReport } from "./build-report.js";
export type {
  BuildFullReportInput,
  FullReport,
  ReportDuplicateContentGroup,
  ReportEdgeDetail,
  ReportEdgeStatus,
  ReportModuleDetail,
  ReportSections,
} from "./build-report.js";
export { renderHtmlReport } from "./render-html.js";
export { REPORT_CSS, escapeHtml } from "./template.js";
