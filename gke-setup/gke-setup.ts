import * as pulumi from '@pulumi/pulumi';
import * as gcp from '@pulumi/gcp';
import * as kubernetes from '@pulumi/kubernetes';

const project = "starlit-factor-431711-m7"

export interface UseCaseConfig {
    useCaseId: string;
    roles: string[];
  }

  export class GoogleServiceAccounts extends pulumi.ComponentResource {
    constructor(name: string, serviceAccounts: UseCaseConfig[], opts?: pulumi.ComponentResourceOptions, kubeconfig?: pulumi.Output<string>) {
      super('examples:iam:GoogleServiceAccounts', name, {}, opts);

      const k8sProvider = new kubernetes.Provider(`k8s-provider`, {
        kubeconfig: kubeconfig!,
      }, { parent: this });
  
      serviceAccounts.forEach((saConfig, index) => {
        const account = new gcp.serviceaccount.Account(`service-account-${index}`, {
          accountId: "mb-it4ad-dev" + saConfig.useCaseId + "-sa",
          displayName: "Service Account for GKE" + saConfig.useCaseId,
        }, { parent: this });
  
        saConfig.roles.forEach((role, roleIndex) => {
          new gcp.projects.IAMMember(`service-account-binding-${index}-${roleIndex}`, {
            project: project,
            role: role,
            member: pulumi.interpolate`serviceAccount:${account.email}`,
          });
        });
  
        const namespace = new kubernetes.core.v1.Namespace(`namespace-${saConfig.useCaseId}`, {
          metadata: {
            name: "k8s-ns-" + saConfig.useCaseId,
          },
        }, { provider: k8sProvider }); 

        const kubernetesServiceAccount = new kubernetes.core.v1.ServiceAccount(`sa-${saConfig.useCaseId}`, {
          metadata: {
            name: "mb-it4ad-dev" + saConfig.useCaseId + "-sa",
            namespace: namespace.metadata.name,
            annotations: {
              "iam.gke.io/gcp-service-account": account.email,
            },
          },
        }, { provider: k8sProvider });  

        new gcp.serviceaccount.IAMMember(`wi-user-${saConfig.useCaseId}`, {
          serviceAccountId: account.name,
          role: "roles/iam.workloadIdentityUser",
          member: pulumi.interpolate`serviceAccount:${project}.svc.id.goog[${namespace.metadata.name}/${kubernetesServiceAccount.metadata.name}]`,
        });
      });
    }
  }