// Memory-only cache. Eviction never deletes archived observations.
export class BoundedCache {
  constructor({max=1000,ttl=86400000,now=Date.now}={}){this.max=max;this.ttl=ttl;this.now=now;this.entries=new Map();}
  get(key){const item=this.entries.get(key);if(!item)return undefined;if(item.until<=this.now()){this.entries.delete(key);return undefined;}return item.value;}
  has(key){return this.get(key)!==undefined;}
  set(key,value){this.prune();this.entries.delete(key);while(this.entries.size>=this.max)this.entries.delete(this.entries.keys().next().value);this.entries.set(key,{value,until:this.now()+this.ttl});return this;}
  prune(){const now=this.now();for(const [k,v] of this.entries)if(v.until<=now)this.entries.delete(k);}
  get size(){this.prune();return this.entries.size;}
}
