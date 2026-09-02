import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { createAgencyTrainingReadRepository } from "@/lib/agency-training/read-repository";

type RouteContext = { params: Promise<{ eventId: string; certificateId: string }> };
function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function pdfText(value: unknown) { return clean(value).normalize("NFKD").replace(/[^\x20-\x7E]/g, ""); }

export async function GET(_request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  const { eventId, certificateId } = await routeContext.params;
  try {
  const data = await createAgencyTrainingReadRepository(context.admin, context.departmentId).getCertificate({ departmentId: context.departmentId, eventId, certificateId });
  if (!data) return NextResponse.json({ error: "Certificate not found." }, { status: 404 });
  const result = { data: data.certificate as any };
  const profile = { data: data.profile };

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([792, 612]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.04, 0.09, 0.18);
  const blue = rgb(0.12, 0.42, 0.92);
  page.drawRectangle({ x: 0, y: 0, width: 792, height: 612, color: rgb(0.97, 0.98, 1) });
  page.drawRectangle({ x: 24, y: 24, width: 744, height: 564, borderColor: navy, borderWidth: 3 });
  page.drawRectangle({ x: 34, y: 34, width: 724, height: 544, borderColor: blue, borderWidth: 1 });
  const centered = (value: string, y: number, size: number, font: any, color = navy) => {
    const width = font.widthOfTextAtSize(value, size);
    page.drawText(value, { x: (792 - width) / 2, y, size, font, color });
  };
  centered(pdfText(result.data.departments?.name) || pdfText(context.departmentName) || "TracePoint Agency", 530, 16, bold, blue);
  centered("CERTIFICATE OF COMPLETION", 470, 28, bold);
  centered("This certifies that", 420, 12, regular, rgb(0.32, 0.38, 0.48));
  centered(pdfText(profile.data?.full_name) || "Department Member", 370, 30, bold, blue);
  centered("successfully completed", 330, 12, regular, rgb(0.32, 0.38, 0.48));
  centered(pdfText(result.data.certificate_title), 285, 22, bold);
  const eventDate = new Date(result.data.agency_training_events?.starts_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const detail = [eventDate, result.data.training_hours != null ? `${result.data.training_hours} training hours` : "", pdfText(result.data.agency_training_events?.location)].filter(Boolean).join("  |  ");
  centered(detail, 240, 11, regular, rgb(0.32, 0.38, 0.48));
  if (pdfText(result.data.instructor_display)) centered(`Instructor: ${pdfText(result.data.instructor_display)}`, 205, 11, regular);
  centered(`Certificate ${result.data.certificate_number}`, 92, 9, bold, rgb(0.32, 0.38, 0.48));
  centered(`Verification ${result.data.verification_code}`, 72, 8, regular, rgb(0.42, 0.48, 0.58));
  const bytes = await pdf.save();
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const safe = clean(profile.data?.full_name).replace(/[^a-zA-Z0-9]+/g, "-") || "certificate";
  return new NextResponse(body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safe}-training-certificate.pdf"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Certificate could not be loaded." }, { status: 500 }); }
}
