import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as autoscalingt from "aws-cdk-lib/aws-autoscaling-hooktargets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as pipes from "aws-cdk-lib/aws-pipes";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as sfnt from "aws-cdk-lib/aws-stepfunctions-tasks";

type AssignEipProps = {
  eipAllocationId: string;
  autoScalingGroup: autoscaling.IAutoScalingGroup;
};

class AssignEip extends Construct {
  readonly stateMachine: sfn.IStateMachine;

  constructor(scope: Construct, id: string, props: AssignEipProps) {
    super(scope, id);

    /*
{"Origin":"EC2","LifecycleHookName":"DenoTestStack-AutoscalingGroupLifecycleHookOnLaunch49A664EF-3lhKS3adlUsx","Destination":"AutoScalingGroup","AccountId":"266608227104","RequestId":"5a062a09-2965-8413-43f9-83bd8649c9eb","LifecycleTransition":"autoscaling:EC2_INSTANCE_LAUNCHING","AutoScalingGroupName":"DenoTestStack-AutoscalingGroupASG25987EFB-1FXPOBZFMDQTL","Service":"AWS Auto Scaling","Time":"2023-09-11T03:30:33.136Z","EC2InstanceId":"i-0853dfa8ce1627af9","LifecycleActionToken":"917070d0-a303-474b-a36c-a5e38a19de5e"}

{"AccountId":"266608227104","RequestId":"c0f77046-9a4e-4fcf-8594-34b174a83c04","AutoScalingGroupARN":"arn:aws:autoscaling:ap-northeast-1:266608227104:autoScalingGroup:2f70c37a-fcb4-4f83-95eb-fa0aae7cc9b6:autoScalingGroupName/DenoTestStack-AutoscalingGroupASG25987EFB-1FXPOBZFMDQTL","AutoScalingGroupName":"DenoTestStack-AutoscalingGroupASG25987EFB-1FXPOBZFMDQTL","Service":"AWS Auto Scaling","Event":"autoscaling:TEST_NOTIFICATION","Time":"2023-09-11T03:03:14.022Z"}
     */

    const forEach = new sfn.Map(this, "ForEach");

    const parseBody = new sfn.Pass(this, "ParseBody", {
      parameters: {
        body: sfn.JsonPath.stringToJson(sfn.JsonPath.stringAt("$.body")),
      },
      outputPath: "$.body",
    });

    const skipTestNotification = new sfn.Choice(this, "SkipTestNotification");

    const associateAddress = new sfnt.CallAwsService(this, "AssociateAddress", {
      service: "ec2",
      action: "associateAddress",
      iamResources: [
        `arn:${cdk.Aws.PARTITION}:ec2:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:elastic-ip/${props.eipAllocationId}`,
      ],
      additionalIamStatements: [
        new iam.PolicyStatement({
          actions: [
            "ec2:AssociateAddress",
          ],
          resources: [
            `arn:${cdk.Aws.PARTITION}:ec2:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:instance/*`,
          ],
          conditions: {
            "StringEquals": {
              "ec2:ResourceTag/aws:autoscaling:groupName": [
                props.autoScalingGroup.autoScalingGroupName,
              ],
            },
          },
        }),
      ],
      parameters: {
        AllocationId: props.eipAllocationId,
        AllowReassociation: true,
        InstanceId: sfn.JsonPath.stringAt("$.EC2InstanceId"),
      },
      resultPath: sfn.JsonPath.DISCARD,
    });

    const complete = new sfnt.CallAwsService(this, "Complete", {
      service: "autoscaling",
      action: "completeLifecycleAction",
      iamResources: [
        props.autoScalingGroup.autoScalingGroupArn,
      ],
      parameters: {
        AutoScalingGroupName: sfn.JsonPath.stringAt("$.AutoScalingGroupName"),
        LifecycleActionResult: "CONTINUE",
        LifecycleHookName: sfn.JsonPath.stringAt("$.LifecycleHookName"),
        LifecycleActionToken: sfn.JsonPath.stringAt("$.LifecycleActionToken"),
      },
    });

    const skip = new sfn.Pass(this, "Skip");

    forEach.iterator(parseBody.next(
      skipTestNotification.when(
        sfn.Condition.stringEquals("$.Event", "autoscaling:TEST_NOTIFICATION"),
        skip,
      ).otherwise(associateAddress.next(complete)),
    ));

    this.stateMachine = new sfn.StateMachine(this, "StateMachine", {
      definitionBody: sfn.DefinitionBody.fromChainable(forEach),
    });
  }
}

type QueueToStateMachinePipeProps = {
  queue: sqs.IQueue;
  stateMachine: sfn.IStateMachine;
};

class QueueToStateMachinePipe extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: QueueToStateMachinePipeProps,
  ) {
    super(scope, id);

    const role = new iam.Role(this, "PipeRole", {
      assumedBy: new iam.ServicePrincipal(
        "pipes.amazonaws.com",
      ) as iam.IPrincipal,
    });

    new pipes.CfnPipe(this, "Pipe", {
      roleArn: role.roleArn,
      source: props.queue.queueArn,
      sourceParameters: {
        sqsQueueParameters: {},
      },
      target: props.stateMachine.stateMachineArn,
      targetParameters: {
        stepFunctionStateMachineParameters: {
          invocationType: "FIRE_AND_FORGET",
        },
      },
    });
    props.queue.grantConsumeMessages(role);
    props.stateMachine.grantStartExecution(role);
  }
}

export class Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const eip = new ec2.CfnEIP(this, "Eip", {
      tags: [
        {
          key: "Name",
          value: `${this.stackName}/Eip`,
        },
      ],
    });

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 1,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });
    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc: vpc as ec2.IVpc,
    });

    const queue = new sqs.Queue(this, "Queue");

    const autoScalingGroup = new autoscaling.AutoScalingGroup(
      this,
      "AutoscalingGroup",
      {
        vpc: vpc as ec2.IVpc,
        vpcSubnets: {
          subnetGroupName: "Public",
        },
        securityGroup: securityGroup,
        minCapacity: 0,
        maxCapacity: 1,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.M7G,
          ec2.InstanceSize.MEDIUM,
        ),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(
          ecs.AmiHardwareType.ARM,
        ),
      },
    );
    autoScalingGroup.addLifecycleHook("OnLaunch", {
      lifecycleTransition: autoscaling.LifecycleTransition.INSTANCE_LAUNCHING,
      notificationTarget: new autoscalingt.QueueHook(queue), // sqs -> pipes -> sfn
    });

    const assignEip = new AssignEip(this, "AssignEip", {
      eipAllocationId: eip.attrAllocationId,
      autoScalingGroup,
    });

    new QueueToStateMachinePipe(this, "QueueToStateMachinePipe", {
      queue,
      stateMachine: assignEip.stateMachine,
    });

    const capacityProvider = new ecs.AsgCapacityProvider(
      this,
      "CapacityProvider",
      {
        autoScalingGroup,
        // enableManagedTerminationProtection: false,
      },
    );
    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc: vpc as ec2.IVpc,
    });
    cluster.addAsgCapacityProvider(capacityProvider);

    const taskDefinition = new ecs.Ec2TaskDefinition(this, "TaskDefinition", {
      // networkMode: ecs.NetworkMode.AWS_VPC, // ENI: RequesterManaged == true
    });
    taskDefinition.addContainer("App", {
      image: ecs.ContainerImage.fromRegistry("debian:bookworm-slim"),
      command: [
        "sleep",
        "inf",
      ],
      linuxParameters: new ecs.LinuxParameters(this, "Parameters", {
        initProcessEnabled: true,
      }),
      memoryLimitMiB: 512,
      logging: ecs.AwsLogDriver.awsLogs({
        streamPrefix: "app",
      }),
    });

    new ecs.Ec2Service(this, "Service", {
      cluster,
      taskDefinition,
      enableExecuteCommand: true,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      capacityProviderStrategies: [
        {
          capacityProvider: capacityProvider.capacityProviderName,
          weight: 1,
        },
      ],
      /*
      vpcSubnets: {
        subnetGroupName: "Public",
      },
      */
    });

    new cdk.CfnOutput(this, "IpAddress", {
      value: eip.attrPublicIp,
    });
  }
}
