package main

import (
	"sync"
	"time"
)

// TokenBucket représente le seau d'une IP
type TokenBucket struct {
	tokens     int
	lastRefill time.Time
	mu         sync.Mutex
}

// IPBuckets est une map concurrente IP → TokenBucket
type IPBuckets struct {
	buckets  sync.Map
	burst    int
	interval time.Duration
}

// NewIPBuckets crée une instance de gestionnaire de buckets IP
func NewIPBuckets(burst int, refillInterval time.Duration) *IPBuckets {
	return &IPBuckets{
		burst:    burst,
		interval: refillInterval,
	}
}

// Allow vérifie si l’IP peut effectuer une requête (true = autorisée)
func (rl *IPBuckets) Allow(ip string) bool {
	now := time.Now()

	val, _ := rl.buckets.LoadOrStore(ip, &TokenBucket{
		tokens:     rl.burst,
		lastRefill: now,
	})

	tb := val.(*TokenBucket)

	tb.mu.Lock()
	defer tb.mu.Unlock()

	// Refill si nécessaire
	elapsed := now.Sub(tb.lastRefill)
	if elapsed >= rl.interval {
		refills := int(elapsed / rl.interval)
		tb.tokens += refills
		if tb.tokens > rl.burst {
			tb.tokens = rl.burst
		}
		tb.lastRefill = now
	}

	if tb.tokens <= 0 {
		return false
	}

	tb.tokens--
	return true
}
