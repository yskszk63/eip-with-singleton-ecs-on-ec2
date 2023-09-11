import { assertSnapshot } from "std/testing/snapshot.ts";

import { Template } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib";

import { Stack } from "@/stack.ts";

Deno.test({
  name: "Snapshot",
  fn(t) {
    const app = new cdk.App();
    const stack = new Stack(app, "Stack", {
      env: {
        account: "123456789012",
        region: "xx-north-0",
      },
    });

    const template = Template.fromStack(stack);
    assertSnapshot(t, template.toJSON());
  },

  // error: Leaking resources:
  //   - A "cryptoDigest" resource (rid 3) was created during the test, but not cleaned up during the test. Close the resource before the end of the test.
  sanitizeResources: false,
});
