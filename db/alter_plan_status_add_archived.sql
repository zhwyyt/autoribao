DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'plan_status'
      AND e.enumlabel = 'archived'
  ) THEN
    ALTER TYPE plan_status ADD VALUE 'archived';
  END IF;
END
$$;
