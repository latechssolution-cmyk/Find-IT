"""Supplement to oci_inventory: the remaining billable service types."""
import oci

cfg = oci.config.from_file()
comp = cfg["tenancy"]

lb = oci.load_balancer.LoadBalancerClient(cfg)
lbs = lb.list_load_balancers(comp).data
print(f"load balancers: {len(lbs)}")
for x in lbs:
    print("  ", x.display_name, x.shape_name, x.lifecycle_state)

nlb = oci.network_load_balancer.NetworkLoadBalancerClient(cfg)
nlbs = nlb.list_network_load_balancers(comp).data.items
print(f"network LBs: {len(nlbs)}")

try:
    db = oci.database.DatabaseClient(cfg)
    adbs = db.list_autonomous_databases(comp).data
    print(f"autonomous DBs: {len(adbs)}")
    for a in adbs:
        print("  ", a.display_name, a.is_free_tier, a.lifecycle_state)
except Exception as e:
    print("adb check:", str(e)[:80])

os_client = oci.object_storage.ObjectStorageClient(cfg)
ns = os_client.get_namespace().data
buckets = os_client.list_buckets(ns, comp).data
print(f"object storage buckets: {len(buckets)}")
for b in buckets:
    print("  ", b.name)

fs = oci.file_storage.FileStorageClient(cfg)
identity = oci.identity.IdentityClient(cfg)
ads = identity.list_availability_domains(comp).data
n_fs = 0
for ad in ads:
    n_fs += len(fs.list_file_systems(comp, ad.name).data)
print(f"file systems: {n_fs}")
