package main

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// rateLimitIP : token bucket simple en mémoire (à mettre en middleware global)
type tokenBucket struct {
	tokens int
	last   time.Time
}

var buckets = NewIPBuckets( // implémente une map sync.Map ip->*tokenBucket
	200,            // burst
	30*time.Second, // refill interval
)

// ---------- Middlewares ----------

func RateLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		if !buckets.Allow(ip) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "rate limited"})
			return
		}
		c.Next()
	}
}

func TimeoutMiddleware(timeout time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}
