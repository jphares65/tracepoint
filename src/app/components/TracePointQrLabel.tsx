"use client";

import { Download, Printer, QrCode, X } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

import {
  buildTracePointQrValue,
  type TracePointQrKind,
} from "@/lib/tracepoint/qr-identifiers";

type Props = {
  kind: TracePointQrKind;
  id: string;
  title: string;
  subtitle?: string;
  compact?: boolean;
  viewOnly?: boolean;
};

export default function TracePointQrLabel({
  kind,
  id,
  title,
  subtitle,
  compact = false,
  viewOnly = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const value = useMemo(() => buildTracePointQrValue(kind, id), [id, kind]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    QRCode.toDataURL(value, {
      errorCorrectionLevel: "H",
      margin: 3,
      width: 720,
      color: { dark: "#020617", light: "#ffffff" },
    })
      .then((nextDataUrl) => {
        if (active) setDataUrl(nextDataUrl);
      })
      .catch(() => {
        if (active) setError("The QR label could not be generated.");
      });
    return () => {
      active = false;
    };
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const download = () => {
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `tracepoint-${kind}-${safeFilename(title)}.png`;
    link.click();
  };

  const print = () => {
    if (!dataUrl) return;
    const printWindow = window.open("", "_blank", "width=720,height=760");
    if (!printWindow) {
      setError("Allow pop-ups to print this label.");
      return;
    }
    printWindow.opener = null;

    const doc = printWindow.document;
    doc.title = `TracePoint ${title}`;
    const style = doc.createElement("style");
    style.textContent = `
      @page { size: 4in 3in; margin: 0; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, sans-serif; color: #020617; }
      main { width: 4in; height: 3in; padding: .18in; border: 2px solid #0f172a; display: grid; grid-template-columns: 2.25in 1fr; gap: .12in; align-items: center; }
      img { width: 2.15in; height: 2.15in; }
      .brand { color: #0b63f6; font-size: 11pt; font-weight: 900; letter-spacing: .08em; }
      h1 { margin: .12in 0 .06in; font-size: 18pt; line-height: 1.05; }
      p { margin: 0 0 .08in; color: #334155; font-size: 10pt; line-height: 1.3; }
      .kind { text-transform: uppercase; font-size: 8pt; font-weight: 800; letter-spacing: .1em; }
      .verified { margin-top: .16in; font-size: 8pt; font-weight: 700; color: #0369a1; }
    `;
    const main = doc.createElement("main");
    const image = doc.createElement("img");
    image.src = dataUrl;
    image.alt = `TracePoint QR code for ${title}`;
    const copy = doc.createElement("div");
    const brand = doc.createElement("div");
    brand.className = "brand";
    brand.textContent = "TRACEPOINT";
    const heading = doc.createElement("h1");
    heading.textContent = title;
    const kindText = doc.createElement("p");
    kindText.className = "kind";
    kindText.textContent = kind === "vehicle" ? "Vehicle inspection" : "Equipment custody";
    const subtitleText = doc.createElement("p");
    subtitleText.textContent = subtitle || id;
    const verified = doc.createElement("p");
    verified.className = "verified";
    verified.textContent = "Operational accountability. Verified.";
    copy.append(brand, heading, kindText, subtitleText, verified);
    main.append(image, copy);
    doc.head.append(style);
    doc.body.replaceChildren(main);
    image.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError("The vehicle link could not be copied.");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setDataUrl("");
          setError("");
          setCopied(false);
          setOpen(true);
        }}
        className={compact
          ? "inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 transition hover:border-blue-500/40 hover:text-blue-300"
          : "inline-flex items-center gap-2 rounded-xl border border-blue-700 px-4 py-2 text-xs font-semibold text-blue-300"}
      >
        <QrCode size={compact ? 12 : 14} /> {viewOnly ? "View QR" : "QR Label"}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm" onClick={() => setOpen(false)} role="presentation">
          <div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={viewOnly ? `QR code for ${title}` : `QR label for ${title}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">{viewOnly ? "Vehicle QR" : "TracePoint QR Label"}</p>
                <h2 className="mt-2 text-xl font-bold text-white">{title}</h2>
                <p className="mt-1 text-xs text-slate-400">{subtitle || id}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-slate-700 p-2 text-slate-400 hover:text-white" aria-label="Close QR label">
                <X size={16} />
              </button>
            </div>

            {viewOnly ? <p className="mt-3 text-sm text-slate-300">Scan with a mobile device to open this vehicle.</p> : null}
            <div className="mt-5 flex min-h-72 items-center justify-center rounded-2xl bg-white p-4">
              {dataUrl ? <Image src={dataUrl} alt={`TracePoint QR code for ${title}`} width={256} height={256} unoptimized className="h-64 w-64" /> : error ? <p className="text-sm text-red-700">{error}</p> : <p className="text-sm text-slate-500">Generating label…</p>}
            </div>
            {viewOnly ? (
              <div className="mt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-200">
                  Close
                </button>
                <button type="button" onClick={() => void copyLink()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white">
                  {copied ? "Copied" : "Copy Link"}
                </button>
              </div>
            ) : (
              <>
                <code className="mt-3 block overflow-x-auto rounded-xl bg-slate-950 p-3 text-[10px] text-slate-400">{value}</code>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button type="button" disabled={!dataUrl} onClick={download} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-xs font-semibold text-slate-200 disabled:opacity-40">
                    <Download size={14} /> Download PNG
                  </button>
                  <button type="button" disabled={!dataUrl} onClick={print} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-semibold text-white disabled:opacity-40">
                    <Printer size={14} /> Print Label
                  </button>
                </div>
              </>
            )}
            {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function safeFilename(value: string) {
  return value.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "label";
}
