CREATE TABLE "convention_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"sample_count" integer NOT NULL,
	"config_count" integer NOT NULL,
	"candidates_raw" integer NOT NULL,
	"candidates_kept" integer NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"category" text NOT NULL,
	"rule" text NOT NULL,
	"evidence_path" text NOT NULL,
	"evidence_start_line" integer NOT NULL,
	"evidence_end_line" integer NOT NULL,
	"evidence_snippet" text NOT NULL,
	"confidence" double precision NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "convention_scans" ADD CONSTRAINT "convention_scans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD CONSTRAINT "convention_scans_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_scan_id_convention_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."convention_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "convention_scans_repo_idx" ON "convention_scans" USING btree ("workspace_id","repo_id");--> statement-breakpoint
CREATE INDEX "conventions_repo_idx" ON "conventions" USING btree ("workspace_id","repo_id");