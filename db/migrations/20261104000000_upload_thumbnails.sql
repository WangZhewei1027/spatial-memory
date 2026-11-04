-- Associate generated thumbnails with the main upload receipt so every client
-- gets the same asset resources without a new upload-response contract.
ALTER TABLE public.upload_receipt
  ADD COLUMN thumbnail_receipt_id uuid REFERENCES public.upload_receipt(id) ON DELETE SET NULL,
  ADD CONSTRAINT upload_receipt_thumbnail_not_self CHECK (thumbnail_receipt_id IS DISTINCT FROM id);
CREATE INDEX upload_receipt_thumbnail_idx ON public.upload_receipt(thumbnail_receipt_id)
  WHERE thumbnail_receipt_id IS NOT NULL;
