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

const PublicDNSEndpoint = new command.local.Command("public-dns-endpoint", {
  create: pulumi.interpolate`
  gcloud container clusters update ${cluster.name} --location=${cluster.location} --enable-dns-access \\ 
  --quiet && gcloud container clusters describe ${cluster.name} --location=${cluster.location} \\
  --format="value(controlPlaneEndpointsConfig.dnsEndpointConfig.endpoint)"
  `
});

console.log(PublicDNSEndpoint)

// Generate the kubeconfig for the created cluster
export const kubeconfig = pulumi.all([cluster.name, cluster.endpoint, cluster.masterAuth]).apply(([name, endpoint, masterAuth]) => {
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
