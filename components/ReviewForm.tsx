"use client";

import { useState } from "react";
import { Button, RatingScale } from "./ui";

// "How was it": the rating scale, an optional line for Louie, one Log button
// that says the number. Shared by the watchlist cards and Quick Rate.
export function ReviewForm({
  title,
  predicted,
  onSubmit,
  onCancel,
}: {
  title: string;
  predicted?: string;
  onSubmit: (rating: number, review: string) => void;
  onCancel: () => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [review, setReview] = useState("");
  return (
    <div className="mt-3 rounded-2xl border border-border bg-surface-2 p-4">
      <RatingScale value={rating} onChange={setRating} predicted={predicted} label={`Rating for ${title}`} />
      <label className="mt-4 block">
        <span className="text-xs font-semibold tracking-[0.08em] text-muted">A LINE FOR LOUIE (OPTIONAL)</span>
        <textarea
          value={review}
          onChange={(e) => setReview(e.target.value)}
          placeholder="What stuck with you?"
          rows={2}
          className="mt-2 w-full resize-none rounded-xl border border-border bg-surface-0 px-3.5 py-2.5 text-base outline-none placeholder:text-muted focus:border-accent-border md:text-sm"
        />
      </label>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="filled" size="md" className="flex-1" disabled={!rating} onClick={() => rating && onSubmit(rating, review.trim())}>
          {rating ? `Log it as ${rating === 8 ? "an" : "a"} ${rating}` : "Log it"}
        </Button>
        <Button variant="ghost" size="md" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
