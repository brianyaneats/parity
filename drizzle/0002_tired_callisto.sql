CREATE TABLE "email_send_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"send_date" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	CONSTRAINT "email_send_counters_email_send_date_unique" UNIQUE("email","send_date")
);
--> statement-breakpoint
CREATE TABLE "email_send_daily_totals" (
	"send_date" date PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
