import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as command from "@pulumi/command";
import { GoogleServiceAccounts, UseCaseConfig } from './gke-setup/gke-setup';

const cluster = new gcp.container.Cluster("my-gke-cluster", {
  initialNodeCount: 1,
  location: "us-central1",
  nodeConfig: {
      machineType: "e2-medium",
  },
  deletionProtection: false,
});

const checkDnsEndpointCommand = new command.local.Command("check-dns-endpoint", {
  create: pulumi.interpolate`
  gcloud container clusters describe ${cluster.name} --location=${cluster.location} --format="value(controlPlaneEndpointsConfig.dnsEndpointConfig.allowExternalTraffic)"
  `,
  triggers: [new Date().toISOString()],
});

const dnsEndpointStatus = checkDnsEndpointCommand.stdout.apply(stdout => {
  console.info(`Output from checkDnsEndpoint: ${stdout}`);
  return stdout === "True"; // Return true if enabled, false otherwise
});

const dnsEndpointInfo = dnsEndpointStatus.apply(isEnabled => {
  if (!isEnabled) {
    // Enable DNS access if not already enabled
    console.log("============== DNS endpoint will be enabled now.");
    const enableDnsEndpoint = new command.local.Command('enable-dns-endpoint', {
      create: pulumi.interpolate`
      gcloud container clusters update ${cluster.name} --location=${cluster.location} --enable-dns-access --no-user-output-enabled
      `
    }, { dependsOn: [checkDnsEndpointCommand] });

    // Return the endpoint after enabling
    return enableDnsEndpoint.stdout.apply(() => {
      const getDnsEndpoint = new command.local.Command('get-dns-endpoint', {
        create: pulumi.interpolate`
        gcloud container clusters describe ${cluster.name} --location=${cluster.location} --format="value(controlPlaneEndpointsConfig.dnsEndpointConfig.endpoint)"
        `
      }, { dependsOn: [enableDnsEndpoint] });
      return getDnsEndpoint.stdout; // Return the endpoint
    });
  } else {
    // DNS endpoint is already enabled
    console.log("============== DNS endpoint is already enabled.");
    const getDnsEndpoint = new command.local.Command('get-dns-endpoint', {
      create: pulumi.interpolate`
      gcloud container clusters describe ${cluster.name} --location=${cluster.location} --format="value(controlPlaneEndpointsConfig.dnsEndpointConfig.endpoint)"
      `
    });
    return getDnsEndpoint.stdout; // Return the endpoint
  }
});

dnsEndpointInfo.apply(endpoint => {
  console.log(`DNS Endpoint: ${endpoint}`); 
  // ... use the endpoint for further operations ...
});

// Check config
/*
const dnsEndpointEnabled = checkDnsEndpointCommand.stdout.apply(stdout => {
  console.info(`Output from checkDnsEndpoint: ${stdout}`)
  if (stdout === "False") {
    console.log("============== DNS endpoint will be enabled now.");
    return new Promise<void>((resolve, reject) => {
      const enableDnsEndpoint = new command.local.Command('enable-dns-endpoint', {
        create: pulumi.interpolate`
        gcloud container clusters update ${cluster.name} --location=${cluster.location} --enable-dns-access --no-user-output-enabled
        `
      }, { dependsOn: [checkDnsEndpointCommand] });
      enableDnsEndpoint.stdout.apply(() => resolve());
    });
  } else {
    console.log("============== DNS endpoint is already enabled.");
    return Promise.resolve();
  }
});

const DnsEndpoint = new command.local.Command("dnsendpoint", {
  create: pulumi.interpolate`
  gcloud container clusters describe ${cluster.name} --location=${cluster.location} --format="value(controlPlaneEndpointsConfig.dnsEndpointConfig.endpoint)"
  `
},
{ dependsOn: [dnsEndpointEnabled] })
*/
/*console.info("Output from the command: ", checkDnsEndpointCommand.stdout);

/*
const PublicDNSEndpoint = new command.local.Command("public-dns-endpoint", {
  create: pulumi.interpolate`
  gcloud container clusters update ${cluster.name} --location=${cluster.location} --enable-dns-access --no-user-output-enabled \\
  && gcloud container clusters describe ${cluster.name} --location=${cluster.location}
  --format="value(controlPlaneEndpointsConfig.dnsEndpointConfig.endpoint)"
  `
});

console.log(PublicDNSEndpoint)*/

// Generate the kubeconfig for the created cluster
export const kubeconfig = pulumi.all([cluster.name, DnsEndpoint.stdout, cluster.masterAuth]).apply(([name, endpoint, masterAuth]) => {
  const context = `${gcp.config.project}_${gcp.config.zone}_${name}`;
  return `
apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${masterAuth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: gke-gcloud-auth-plugin
      installHint: Install gke-gcloud-auth-plugin for use with kubectl by following
        https://cloud.google.com/blog/products/containers-kubernetes/kubectl-auth-changes-in-gke
      provideClusterInfo: true
`;
});

// Create Service Accounts and IAM bindings
const serviceAccountConfigs: UseCaseConfig[] = [
  {
    useCaseId: 'e2e',
    roles: ['roles/storage.admin', 'roles/storage.objectViewer'], // Multiple roles
  },
  {
    useCaseId: 'simulation',
    roles: ['roles/pubsub.admin'],
  },
  {
    useCaseId: 'migration',
    roles: ['roles/storage.admin'],
  },
  // ... more service account configurations ...
];

const serviceAccounts = new GoogleServiceAccounts('service-accounts', serviceAccountConfigs, {
  dependsOn: cluster,
}, kubeconfig);
