# API Reference

## Backend API Endpoints

Base URL: `http://localhost:3000/api`

---

### Health Check

**GET** `/health`

Check if the server is running.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-23T12:00:00.000Z",
  "environment": "development"
}
```

---

### Get All Applicants

**GET** `/api/applicants`

Retrieve a list of all applicants with optional filtering.

**Query Parameters:**
- `status` (optional) - Filter by application status (e.g., "Phone Screen", "Interview")
- `jobId` (optional) - Filter by job posting ID
- `search` (optional) - Search by name or email

**Example Request:**
```
GET /api/applicants?status=interview&search=john
```

**Response:**
```json
{
  "data": [
    {
      "id": 123,
      "name": "John Doe",
      "email": "john.doe@example.com",
      "location": "San Francisco, CA, USA",
      "stage": "Phone Screen",
      "appliedDate": "2025-10-15T00:00:00.000Z",
      "rating": 4
    }
  ],
  "count": 1
}
```

**Error Responses:**
- `500` - Internal Server Error

---

### Get Single Applicant

**GET** `/api/applicants/:id`

Retrieve detailed information about a specific applicant.

**Path Parameters:**
- `id` (required) - The applicant's ID

**Example Request:**
```
GET /api/applicants/123
```

**Response:**
```json
{
  "data": {
    "id": 123,
    "name": "John Doe",
    "email": "john.doe@example.com",
    "location": "San Francisco, CA, USA",
    "stage": "Phone Screen",
    "appliedDate": "2025-10-15T00:00:00.000Z",
    "rating": 4,
    "phoneNumber": "+1-555-123-4567",
    "address": "123 Main St",
    "source": "LinkedIn",
    "linkedInUrl": "https://linkedin.com/in/johndoe",
    "websiteUrl": "https://johndoe.com",
    "coverLetter": "I am very interested in this position...",
    "resumeFileId": 456,
    "aiSummary": "John Doe applied on October 15, 2025...",
    "createdDate": "2025-10-15T08:30:00.000Z",
    "modifiedDate": "2025-10-20T14:22:00.000Z"
  }
}
```

**Error Responses:**
- `400` - Bad Request (invalid ID)
- `404` - Not Found
- `500` - Internal Server Error

---

### Get Applicant Resume

**GET** `/api/applicants/:id/resume`

Retrieve and parse an applicant's resume as JSON.

**Path Parameters:**
- `id` (required) - The applicant's ID

**Example Request:**
```
GET /api/applicants/123/resume
```

**Response:**
```json
{
  "data": {
    "applicationId": 123,
    "resumeFileId": 456,
    "parsed": {
      "text": "JOHN DOE\nSoftware Engineer\n\nEXPERIENCE\n...",
      "metadata": {
        "pages": 2,
        "info": {
          "Title": "John Doe Resume",
          "Author": "John Doe",
          "CreationDate": "2025-10-10T00:00:00.000Z"
        }
      }
    },
    "extracted": {
      "emails": ["john.doe@example.com"],
      "phones": ["+1-555-123-4567"],
      "urls": ["https://johndoe.com", "https://linkedin.com/in/johndoe"],
      "lines": ["JOHN DOE", "Software Engineer", "EXPERIENCE", "..."]
    }
  }
}
```

**Error Responses:**
- `400` - Bad Request (invalid ID)
- `404` - Not Found (no resume available)
- `500` - Internal Server Error (failed to parse PDF)

---

## BambooHR API Integration

The backend acts as a secure proxy to the BambooHR API. The following BambooHR endpoints are used internally:

### Used Internally

- **Get Applications:** `GET https://{subdomain}.bamboohr.com/api/v1/applicant_tracking/applications`
- **Get Application:** `GET https://{subdomain}.bamboohr.com/api/v1/applicant_tracking/applications/{applicationId}`
- **Get Application Statuses:** `GET https://{subdomain}.bamboohr.com/api/v1/applicant_tracking/statuses`
- **Get Resume File:** `GET https://{subdomain}.bamboohr.com/api/v1/applicant_tracking/applications/{applicationId}/files/{resumeFileId}`

These endpoints are NOT exposed to the frontend. All communication goes through our backend API.

---

## Error Response Format

All error responses follow this format:

```json
{
  "error": "ErrorType",
  "message": "Human-readable error message",
  "statusCode": 400
}
```

Common error types:
- `BadRequest` - Invalid request parameters
- `NotFound` - Resource not found
- `InternalServerError` - Server error

In development mode, error responses may include a `stack` field with the error stack trace.

---

## Rate Limiting

The API is rate-limited to 100 requests per 15 minutes per IP address. If you exceed this limit, you'll receive a `429 Too Many Requests` response.

---

## CORS

CORS is configured to allow requests from `http://localhost:5173` (the default Vite dev server). To allow requests from other origins, update the `CLIENT_URL` environment variable.

---

## Authentication

Currently, the API does not require authentication from the frontend. All authentication with BambooHR is handled server-side using the API key stored in environment variables.

Future versions may include user authentication.

