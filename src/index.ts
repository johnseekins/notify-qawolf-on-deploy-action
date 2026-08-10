import * as core from "@actions/core";
import * as github from "@actions/github";

import { makeQaWolfSdk } from "@qawolf/ci-sdk";
import { coreLogDriver, stringifyUnknown } from "@qawolf/ci-utils";

import packageJson from "../package.json" with { type: "json" };

import { extractRelevantDataFromEvent } from "./extractRelevantDataFromEvent/index.js";
import { validateInput } from "./validateInput.js";

async function runGitHubAction() {
  core.debug("Extracting relevant event data.");
  const relevantEventData = await extractRelevantDataFromEvent(github.context);
  core.debug(`Relevant event data: ${JSON.stringify(relevantEventData)}`);
  core.debug("Validating input.");
  const validationResult = validateInput(relevantEventData);
  if (!validationResult.isValid) {
    core.setFailed(`Action input is invalid: ${validationResult.error}`);
    return;
  }
  const { apiKey, deployConfig, qawolfBaseUrl } = validationResult;
  const { attemptNotifyDeploy } = makeQaWolfSdk(
    {
      apiKey,
      serviceBase: qawolfBaseUrl,
      userAgent: `notify-qawolf-on-deploy-action/${packageJson.version}`,
    },
    {
      // Replace default log driver with core logging.
      log: coreLogDriver,
    },
  );
  core.info("Attempting to notify QA Wolf of deployment.");
  const deployResult = await attemptNotifyDeploy(deployConfig);
  if (deployResult.outcome === "aborted") {
    core.setFailed(
      `Failed to reach QA Wolf API with reason "${deployResult.abortReason}" ${
        deployResult.httpStatus
          ? `, HTTP status ${deployResult.httpStatus}`
          : ""
      }.`,
    );
    return;
  }
  if (deployResult.outcome === "failed") {
    core.setFailed(
      `Failed notifying QA Wolf of deployment with reason "${deployResult.failReason}"`,
    );
    return;
  }

  if (deployResult.outcome === "skipped") {
    // No trigger matched this deployment. This is deterministic given the
    // current configuration, so it is a skip rather than a failure: the step
    // passes without producing a run. WIZ-10858 tracks a fuller audit of this
    // action's behavior.
    core.info(
      deployResult.skippedDeployment
        ? `No QA Wolf run was created for this deployment: ${deployResult.skippedDeployment.message}`
        : "No QA Wolf run was created for this deployment because no trigger matched. Nothing to test.",
    );
    return;
  }
  const { environmentId, runId } = deployResult;
  core.setOutput("environment-id", environmentId);
  core.setOutput("run-id", runId);
  const runUrl = runId ? new URL(`/runs/${runId}`, qawolfBaseUrl).href : undefined;
  core.setOutput("run-url", runUrl);
}

runGitHubAction().catch((error) => {
  core.setFailed(
    `Action failed with reason: ${stringifyUnknown(error) ?? "Unknown error"}`,
  );
});
