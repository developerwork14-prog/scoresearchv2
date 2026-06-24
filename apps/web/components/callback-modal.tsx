"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { BUSINESS_EMAIL_MESSAGE, isBusinessEmail } from "@/lib/business-email";

type CallbackModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function CallbackModal({ isOpen, onClose }: CallbackModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [requestError, setRequestError] = useState("");

  if (!isOpen) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError("");
    setIsSubmitting(true);

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");

    if (!isBusinessEmail(email)) {
      setRequestError(BUSINESS_EMAIL_MESSAGE);
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email,
          phone: data.get("phone"),
          website: data.get("website")
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message ?? "Could not submit request");
      }

      setIsSubmitted(true);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not submit request");
    } finally {
      setIsSubmitting(false);
    }
  }

  function closeModal() {
    setIsSubmitted(false);
    setRequestError("");
    setIsSubmitting(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111111]/55 px-4 backdrop-blur-sm">
      <div className="w-full max-w-[420px] overflow-hidden rounded-[14px] border border-[#ECECEC] bg-white shadow-[0_18px_60px_rgba(17,17,17,0.22)]">
        {!isSubmitted ? (
          <div className="flex items-start justify-between bg-[#111111] px-5 py-4 text-white">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.08em] text-[#F5E6C8]">Request a Callback</p>
              <h2 className="mt-1 text-2xl font-black">Fix your AI Search Score</h2>
            </div>
            <button type="button" onClick={closeModal} className="rounded-lg bg-white/10 p-2 text-white transition hover:bg-white/16" aria-label="Close callback form">
              <X className="size-5" />
            </button>
          </div>
        ) : null}

        {isSubmitted ? (
          <div className="p-5 text-center">
            <h2 className="text-2xl font-black text-[#111111]">Thanks. We received your request.</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-[#666666]">Our team will contact you shortly with personalized recommendations.</p>
            <Button type="button" onClick={closeModal} className="mt-5 w-full rounded-lg bg-[#F5E6C8] text-[#111111] hover:bg-[#E8D4A8]">
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3 p-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-[#666666]">Name</label>
              <Input name="name" className="min-h-10 bg-[#FAFAFA]" placeholder="Your name" required />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-[#666666]">Company Email ID</label>
              <Input name="email" className="min-h-10 bg-[#FAFAFA]" type="email" placeholder="you@company.com" required />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-[#666666]">Phone Number</label>
              <Input name="phone" className="min-h-10 bg-[#FAFAFA]" type="tel" placeholder="+91 98765 43210" required />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-[#666666]">Website</label>
              <Input name="website" className="min-h-10 bg-[#FAFAFA]" placeholder="https://domain.com" required />
            </div>
            {requestError ? <p className="rounded-lg border border-[#FAD7D7] bg-[#FFF5F5] px-3 py-2 text-xs font-bold text-[#B42318]">{requestError}</p> : null}
            <Button disabled={isSubmitting} className="w-full rounded-lg bg-[#F5E6C8] text-[#111111] hover:bg-[#E8D4A8]" type="submit">
              {isSubmitting ? "Submitting..." : "Submit Request"}
              <ArrowRight className="size-4" />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
