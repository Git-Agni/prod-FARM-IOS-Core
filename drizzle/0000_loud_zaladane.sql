CREATE SCHEMA "scheduler";
--> statement-breakpoint
CREATE TYPE "scheduler"."execution_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped', 'stopped');--> statement-breakpoint
CREATE TYPE "scheduler"."schedule_status" AS ENUM('active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "scheduler"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid,
	"execution_id" uuid,
	"relative_path" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_relative_path_unique" UNIQUE("relative_path")
);
--> statement-breakpoint
CREATE TABLE "scheduler"."execution_attempts" (
	"execution_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"exit_code" integer,
	"error" text,
	CONSTRAINT "execution_attempts_execution_id_attempt_pk" PRIMARY KEY("execution_id","attempt")
);
--> statement-breakpoint
CREATE TABLE "scheduler"."execution_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scheduler"."execution_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"execution_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"line" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler"."executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid,
	"device_udid" text NOT NULL,
	"plugin_id" text NOT NULL,
	"task_type" text NOT NULL,
	"task_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"status" "scheduler"."execution_status" DEFAULT 'queued' NOT NULL,
	"queue_job_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"exit_code" integer,
	"error" text,
	"stop_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler"."schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_udid" text NOT NULL,
	"plugin_id" text NOT NULL,
	"task_type" text NOT NULL,
	"task_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"timing" jsonb NOT NULL,
	"status" "scheduler"."schedule_status" DEFAULT 'active' NOT NULL,
	"run_window_minutes" integer DEFAULT 30 NOT NULL,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduler"."assets" ADD CONSTRAINT "assets_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "scheduler"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."assets" ADD CONSTRAINT "assets_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "scheduler"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."execution_attempts" ADD CONSTRAINT "execution_attempts_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "scheduler"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."execution_logs" ADD CONSTRAINT "execution_logs_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "scheduler"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduler"."executions" ADD CONSTRAINT "executions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "scheduler"."schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_schedule_idx" ON "scheduler"."assets" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "assets_execution_idx" ON "scheduler"."assets" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "execution_logs_execution_idx" ON "scheduler"."execution_logs" USING btree ("execution_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_schedule_occurrence_idx" ON "scheduler"."executions" USING btree ("schedule_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "executions_device_status_idx" ON "scheduler"."executions" USING btree ("device_udid","status");--> statement-breakpoint
CREATE INDEX "executions_plugin_idx" ON "scheduler"."executions" USING btree ("plugin_id","task_type","task_version");--> statement-breakpoint
CREATE INDEX "schedules_due_idx" ON "scheduler"."schedules" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "schedules_device_idx" ON "scheduler"."schedules" USING btree ("device_udid","created_at");--> statement-breakpoint
CREATE INDEX "schedules_plugin_idx" ON "scheduler"."schedules" USING btree ("plugin_id","task_type","task_version");