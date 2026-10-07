const BASE_URL = "https://genius.avoxi.com/api/v2";
const PLUMBER_NUMBER = "+524151740084";
const GA4_PROPERTY_ID = "557925842";

async function getAvoxiCalls(token) {
  const now = new Date();

  const from = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1
  );

  const limit = 100;
  let offset = 0;
  let allCalls = [];

  while (true) {
    const url =
      `${BASE_URL}/cdrs` +
      `?call_start_oldest=${from.toISOString()}` +
      `&call_start_newest=${now.toISOString()}` +
      `&limit=${limit}` +
      `&offset=${offset}` +
      `&timezone=America/Mexico_City`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(
        `AVOXI API error ${response.status}`
      );
    }

    const result = await response.json();
    const calls = result.data || [];

    allCalls = allCalls.concat(calls);

    if (calls.length < limit) {
      break;
    }

    offset += limit;
  }

  return allCalls
    .filter(call => call.to === PLUMBER_NUMBER)
    .map(call => ({
      id: call.avoxi_call_id,
      caller: call.from,
      status:
        call.status === "ANSWERED"
          ? "answered"
          : "unanswered",
      startedAt: call.date_start,
      durationSeconds:
        call.duration?.seconds || 0,
      durationFormatted:
        call.duration?.formatted || ""
    }));
}

function maskCaller(caller) {
  const digits =
    (caller || "").replace(/\D/g, "");

  const local =
    digits.startsWith("52")
      ? digits.slice(2)
      : digits;

  if (local.length < 10) {
    return "Número no disponible";
  }

  return `${local.slice(0, 3)} XXX ${local.slice(-4)}`;
}

function base64UrlEncode(value) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : value;

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(
      "-----BEGIN PRIVATE KEY-----",
      ""
    )
    .replace(
      "-----END PRIVATE KEY-----",
      ""
    )
    .replace(/\s/g, "");

  const binary = atob(base64);

  const bytes =
    new Uint8Array(binary.length);

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function getGoogleAccessToken(
  serviceAccount
) {
  const now =
    Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const payload = {
    iss: serviceAccount.client_email,
    scope:
      "https://www.googleapis.com/auth/analytics.readonly",
    aud:
      "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  const unsignedToken =
    `${base64UrlEncode(
      JSON.stringify(header)
    )}.${base64UrlEncode(
      JSON.stringify(payload)
    )}`;

  const key =
    await crypto.subtle.importKey(
      "pkcs8",
      pemToArrayBuffer(
        serviceAccount.private_key
      ),
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

  const signature =
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(
        unsignedToken
      )
    );

  const assertion =
    `${unsignedToken}.` +
    base64UrlEncode(
      new Uint8Array(signature)
    );

  const body =
    new URLSearchParams({
      grant_type:
        "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    });

  const response =
    await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body
      }
    );

  if (!response.ok) {
    throw new Error(
      `Google authentication error ${response.status}`
    );
  }

  const result =
    await response.json();

  return result.access_token;
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(
      date.getMonth() + 1
    ).padStart(2, "0"),
    String(
      date.getDate()
    ).padStart(2, "0")
  ].join("-");
}

async function getGa4WhatsApp(
  serviceAccountText
) {
  const serviceAccount =
    JSON.parse(serviceAccountText);

  const accessToken =
    await getGoogleAccessToken(
      serviceAccount
    );

  const now = new Date();

  const currentMonthStart =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    );

  const previousMonthStart =
    new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1
    );

  const previousMonthEnd =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      0
    );

  const headers = {
    Authorization:
      `Bearer ${accessToken}`,
    "Content-Type":
      "application/json"
  };

  const reportUrl =
    `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`;

  const reportBody = dateRange => ({
    dateRanges: [
      {
        startDate: formatDate(
          dateRange.start
        ),
        endDate:
          dateRange.end === "today"
            ? "today"
            : formatDate(dateRange.end)
      }
    ],

    dimensions: [
      {
        name: "eventName"
      }
    ],

    metrics: [
      {
        name: "eventCount"
      }
    ],

    dimensionFilter: {
      filter: {
        fieldName:
          "eventName",
        stringFilter: {
          matchType: "EXACT",
          value:
            "whatsapp_click"
        }
      }
    }
  });

  const [
    previousTotalsResponse,
    currentTotalsResponse
  ] = await Promise.all([
    fetch(
      reportUrl,
      {
        method: "POST",
        headers,
        body: JSON.stringify(
          reportBody({
            start:
              previousMonthStart,
            end:
              previousMonthEnd
          })
        )
      }
    ),

    fetch(
      reportUrl,
      {
        method: "POST",
        headers,
        body: JSON.stringify(
          reportBody({
            start:
              currentMonthStart,
            end:
              "today"
          })
        )
      }
    )
  ]);

  if (
    !previousTotalsResponse.ok ||
    !currentTotalsResponse.ok
  ) {
    throw new Error(
      `GA4 monthly API error ${
        previousTotalsResponse.ok
          ? currentTotalsResponse.status
          : previousTotalsResponse.status
      }`
    );
  }

  const previousTotalsResult =
    await previousTotalsResponse.json();

  const currentTotalsResult =
    await currentTotalsResponse.json();

  const previousMonth =
    Number(
      previousTotalsResult.rows?.[0]
        ?.metricValues?.[0]?.value ||
      0
    );

  const currentMonth =
    Number(
      currentTotalsResult.rows?.[0]
        ?.metricValues?.[0]?.value ||
      0
    );

  const historyResponse =
    await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
      {
        method: "POST",
        headers,

        body: JSON.stringify({
          dateRanges: [
            {
              startDate:
                formatDate(
                  previousMonthStart
                ),
              endDate: "today"
            }
          ],

          dimensions: [
            {
              name: "dateHourMinute"
            }
          ],

          metrics: [
            {
              name: "eventCount"
            }
          ],

          dimensionFilter: {
            filter: {
              fieldName:
                "eventName",
              stringFilter: {
                matchType: "EXACT",
                value:
                  "whatsapp_click"
              }
            }
          },

          orderBys: [
            {
              dimension: {
                dimensionName:
                  "dateHourMinute"
              },
              desc: true
            }
          ],

          limit: 100
        })
      }
    );

  if (!historyResponse.ok) {
    throw new Error(
      `GA4 history API error ${historyResponse.status}`
    );
  }

  const historyResult =
    await historyResponse.json();

  const history = [];

  for (
    const row of historyResult.rows || []
  ) {
    const dateHourMinute =
      row.dimensionValues?.[0]?.value ||
      "";

    const eventCount =
      Number(
        row.metricValues?.[0]?.value ||
        0
      );

    history.push({
      dateHourMinute,
      eventCount
    });
  }

  return {
    previousMonth,
    currentMonth,
    history
  };
}

function buildDashboard(
  calls,
  whatsapp
) {
  const now = new Date();

  const currentMonthStart =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      1
    );

  const previousMonthStart =
    new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1
    );

  const currentMonthCalls =
    calls.filter(
      call =>
        new Date(call.startedAt) >=
        currentMonthStart
    );

  const previousMonthCalls =
    calls.filter(call => {
      const date =
        new Date(call.startedAt);

      return (
        date >= previousMonthStart &&
        date < currentMonthStart
      );
    });

  const today =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).format(now);

  const callsToday =
    calls.filter(call => {
      const callDate =
        new Intl.DateTimeFormat(
          "en-CA",
          {
            timeZone:
              "America/Mexico_City",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
          }
        ).format(
          new Date(call.startedAt)
        );

      return callDate === today;
    }).length;

  function monthName(date) {
    return new Intl.DateTimeFormat(
      "es-MX",
      {
        month: "long",
        year: "numeric",
        timeZone:
          "America/Mexico_City"
      }
    ).format(date);
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat(
      "es-MX",
      {
        timeZone:
          "America/Mexico_City",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }
    ).format(
      new Date(value)
    );
  }

  function summarize(
    monthCalls,
    whatsappClicks
  ) {
    return {
      calls: monthCalls.length,

      answered:
        monthCalls.filter(
          call =>
            call.status === "answered"
        ).length,

      missed:
        monthCalls.filter(
          call =>
            call.status === "unanswered"
        ).length,

      whatsappClicks
    };
  }

  const callHistory = [...calls]
    .sort(
      (a, b) =>
        new Date(b.startedAt) -
        new Date(a.startedAt)
    )
    .map(call => ({
      id: call.id,
      status: call.status,
      startedAt: call.startedAt,
      formattedDateTime:
        formatDateTime(
          call.startedAt
        ),
      durationSeconds:
        call.durationSeconds,
      durationFormatted:
        call.durationFormatted,
      maskedCaller:
        maskCaller(call.caller)
    }));

  const whatsappHistory =
    (whatsapp.history || []).map(
      item => {
        const value =
          item.dateHourMinute || "";

        const year =
          value.slice(0, 4);

        const month =
          value.slice(4, 6);

        const day =
          value.slice(6, 8);

        const hour =
          value.slice(8, 10);

        const minute =
          value.slice(10, 12);

        const formattedDateTime =
          `${day}/${month}/${year} ${hour}:${minute}`;

        return {
          dateHourMinute: value,
          eventCount:
            item.eventCount,
          formattedDateTime:
            formattedDateTime
        };
      }
    );

  return {
    callsToday,

    currentMonthName:
      monthName(now),

    previousMonthName:
  monthName(
    new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      15,
      12
    )
  ),

    currentMonth:
      summarize(
        currentMonthCalls,
        whatsapp.currentMonth
      ),

    previousMonth:
      summarize(
        previousMonthCalls,
        whatsapp.previousMonth
      ),

    callHistory,
    whatsappHistory
  };
}

export async function onRequest(context) {
  try {
    const [
      calls,
      whatsapp
    ] = await Promise.all([
      getAvoxiCalls(
        context.env.AVOXI_API_TOKEN
      ),
      getGa4WhatsApp(
        context.env.GA4_SERVICE_ACCOUNT
      )
    ]);

    return Response.json({
      ok: true,
      ...buildDashboard(
        calls,
        whatsapp
      )
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      {
        ok: false,
        error: "Unable to load activity"
      },
      {
        status: 500
      }
    );
  }
}
