import * as cdk from "aws-cdk-lib";

import { Stack } from "@/stack.ts";

const app = new cdk.App();
new Stack(app, "EipWithSingletonEcsOnEc2Stack", {
  env: {
    account: "....", // TODO rewrite!
    region: "....", // TODO rewrite!
  },
  tags: {
    Owner: "....", // TODO rewrite!
  },
});
