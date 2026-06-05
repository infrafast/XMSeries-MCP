export type AutomationCurve = "linear" | "ease_in" | "ease_out" | "ease_in_out";

export interface AutomationRampAction {
    type: "ramp";
    description?: string;
    from?: number;
    to: number;
    durationSeconds: number;
    stepMs?: number;
    curve?: AutomationCurve;
    read: () => Promise<number>;
    write: (value: number) => Promise<void>;
    verifyFinal?: boolean;
    finalTolerance?: number;
}

export interface AutomationDelayAction {
    type: "delay";
    description?: string;
    delaySeconds: number;
    run: () => Promise<void>;
}

export interface AutomationWaitAction {
    type: "wait";
    description?: string;
    durationSeconds: number;
}

export type AutomationAction = AutomationRampAction | AutomationDelayAction | AutomationWaitAction;

export interface AutomationJobSnapshot {
    id: string;
    label: string;
    status: "running" | "completed" | "failed" | "cancelled";
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    currentAction?: string;
    error?: string;
}

interface AutomationJob extends AutomationJobSnapshot {
    actions: AutomationAction[];
    abortController: AbortController;
}

export class AutomationEngine {
    private jobs = new Map<string, AutomationJob>();
    private nextId = 1;

    start(label: string, actions: AutomationAction[]): AutomationJobSnapshot {
        const id = `auto-${this.nextId++}`;
        const job: AutomationJob = {
            id,
            label,
            actions,
            status: "running",
            createdAt: new Date().toISOString(),
            abortController: new AbortController(),
        };

        this.jobs.set(id, job);
        void this.runJob(job);
        return this.snapshot(job);
    }

    cancel(id: string): AutomationJobSnapshot | null {
        const job = this.jobs.get(id);
        if (!job) return null;
        if (job.status === "running") {
            job.status = "cancelled";
            job.finishedAt = new Date().toISOString();
            job.abortController.abort();
        }
        return this.snapshot(job);
    }

    list(): AutomationJobSnapshot[] {
        return [...this.jobs.values()].map((job) => this.snapshot(job));
    }

    private async runJob(job: AutomationJob): Promise<void> {
        job.startedAt = new Date().toISOString();
        try {
            for (const action of job.actions) {
                this.throwIfCancelled(job);
                job.currentAction = action.description || action.type;

                if (action.type === "ramp") {
                    await this.runRamp(job, action);
                } else if (action.type === "delay") {
                    await this.sleep(job, action.delaySeconds * 1000);
                    this.throwIfCancelled(job);
                    await action.run();
                } else {
                    await this.sleep(job, action.durationSeconds * 1000);
                }
            }

            if (job.status === "running") {
                job.status = "completed";
                job.finishedAt = new Date().toISOString();
                job.currentAction = undefined;
            }
        } catch (error) {
            if (job.status !== "cancelled") {
                job.status = "failed";
                job.error = error instanceof Error ? error.message : String(error);
                job.finishedAt = new Date().toISOString();
            }
        }
    }

    private async runRamp(job: AutomationJob, action: AutomationRampAction): Promise<void> {
        const durationMs = Math.max(0, action.durationSeconds * 1000);
        const stepMs = Math.max(20, action.stepMs ?? 100);
        const from = action.from ?? await action.read();
        const to = action.to;

        if (durationMs === 0) {
            await action.write(to);
            await this.verifyRampFinalValue(job, action, clamp01(to));
            return;
        }

        const steps = Math.max(1, Math.ceil(durationMs / stepMs));
        for (let i = 1; i <= steps; i++) {
            this.throwIfCancelled(job);
            const progress = Math.min(1, i / steps);
            const eased = ease(progress, action.curve ?? "linear");
            const value = from + (to - from) * eased;
            await action.write(clamp01(value));
            if (i < steps) {
                await this.sleep(job, stepMs);
            }
        }

        await this.verifyRampFinalValue(job, action, clamp01(to));
    }

    private async verifyRampFinalValue(job: AutomationJob, action: AutomationRampAction, expected: number): Promise<void> {
        if (action.verifyFinal === false) return;

        const attempts = 5;
        const tolerance = action.finalTolerance ?? 0.002;
        let actual = Number.NaN;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            this.throwIfCancelled(job);
            if (attempt > 1) {
                await this.sleep(job, 60);
            }

            actual = await action.read();
            if (Math.abs(actual - expected) <= tolerance) {
                return;
            }
        }

        throw new Error(`Automation final verification failed for ${action.description || "ramp"}: expected ${formatAutomationValue(expected)}, read ${formatAutomationValue(actual)}`);
    }

    private async sleep(job: AutomationJob, ms: number): Promise<void> {
        const deadline = Date.now() + Math.max(0, ms);
        while (Date.now() < deadline) {
            this.throwIfCancelled(job);
            await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())));
        }
    }

    private throwIfCancelled(job: AutomationJob): void {
        if (job.abortController.signal.aborted || job.status === "cancelled") {
            throw new Error("Automation cancelled");
        }
    }

    private snapshot(job: AutomationJob): AutomationJobSnapshot {
        return {
            id: job.id,
            label: job.label,
            status: job.status,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            currentAction: job.currentAction,
            error: job.error,
        };
    }
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function formatAutomationValue(value: number): string {
    return Number.isFinite(value) ? value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") : String(value);
}

function ease(progress: number, curve: AutomationCurve): number {
    switch (curve) {
        case "ease_in":
            return progress * progress;
        case "ease_out":
            return 1 - (1 - progress) * (1 - progress);
        case "ease_in_out":
            return progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        case "linear":
        default:
            return progress;
    }
}
