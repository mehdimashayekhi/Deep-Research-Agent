import { openai } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import FirecrawlApp from "@mendable/firecrawl-js";
import { z } from "zod";
// import { console } from "inspector";

// Initialize Firecrawl
const app = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY || "",
});

export function agent(topic: string) {
    return generateText({ 
        model: openai("gpt-4o"),
        // prompt: `Your job is to help the user with deep research. If needed ask clarifying questions and then call the deep research tool when ready. If deep research tool is not an option, always use the search tool to find relevant information. You should always call a research tool regardless of the question.`,
        prompt: `The user has asked a question. Your task is to perform deep research on their question. You must call the deepResearch tool and use the user's question as the topic parameter. The user's question is: "${topic}"`,
        tools: {
            deepResearch: {
                description:
                    'Perform deep research on a topic using an AI agent that coordinates search, extract, and analysis tools with reasoning steps.',
                parameters: z.object({
                    topic: z.string().describe('The topic or question to research'),
                }),
                execute: async ({ topic, maxDepth = 1 }) => {
                    const startTime = Date.now();
                    const timeLimit = 1.5 * 60 * 1000; // 1 min and 30 seconds in milliseconds

                    const researchState = {
                        findings: [] as Array<{ text: string; source: string }>,
                        summaries: [] as Array<string>,
                        nextSearchTopic: '',
                        urlToSearch: '',
                        currentDepth: 0,
                        failedAttempts: 0,
                        maxFailedAttempts: 3,
                        completedSteps: 0,
                        totalExpectedSteps: maxDepth * 5,
                    };

                    try {
                        while (researchState.currentDepth < maxDepth) {

                            console.debug(`[Research Step] Current topic: ${topic}`);

                            const timeElapsed = Date.now() - startTime;
                            if (timeElapsed >= timeLimit) {
                              break;
                            }

                            researchState.currentDepth++;

                            // Search phase
                            let searchTopic = researchState.nextSearchTopic || topic;
                            const searchResult = await app.search(searchTopic);

                            if (!searchResult.success) {
                                researchState.failedAttempts++;
                                if (
                                    researchState.failedAttempts >=
                                    researchState.maxFailedAttempts
                                  ) {
                                    break;
                                  }
                                  continue;
                            }

                            console.log(searchResult);

                            // Extract phase
                            const topUrls = searchResult.data
                                .slice(0, 3)
                                .map((result: any) => result.url);

                                console.debug(`[Research Step] Extracting from URLs: ${JSON.stringify(topUrls)}`);

                            const extractFromUrls = async (urls: string[]) => {
                                const extractPromises = urls.map(async (url) => {
                                    try {     // URL Validation
                                        try{
                                            new URL(url);
                                        } catch (error) {
                                            console.warn(`Invalid URL: ${url}`);
                                            return [];
                                        }
                                        console.debug("Extracting from URL:", url, "with prompt:", prompt);

                                        const result = await app.extract([url], {
                                            prompt: `Extract key information about ${topic}. Focus on facts, data, and expert opinions. Analysis should be full of details and very comprehensive.`,
                                            });
                                        if (result.success) {

                                            if (Array.isArray(result.data)) {
                                                return result.data.map((item) => ({
                                                  text: item.data,
                                                  source: url,
                                                }));
                                              }
                                            return [{ text: result.data, source: url }];
                                        }
                                        
                                    return []
                                    } catch(error) {
                                        console.warn(`Extraction failed for ${url}:`, error);
                                        return []
                                    }
                                });
                                const results = await Promise.all(extractPromises);
                                return results.flat();
                            };

                            const analyzeAndPlan = async(
                                findings: Array<{ text: string; source: string }>,
                            ) => {
                                try {
                                    const timeElapsed = Date.now() - startTime;
                                    const timeRemaining = timeLimit - timeElapsed;
                                    const timeRemainingMinutes =
                                    Math.round((timeRemaining / 1000 / 60) * 10) / 10;
                                    // Reasoning model
                                    const result = await generateText({
                                        model: openai("gpt-4o"),
                                        prompt: `You are a research agent analyzing findings about: ${topic}
                                        You have ${timeRemainingMinutes} minutes remaining to complete the research but you don't need to use all of it.
                                        Current findings: ${findings
                                    .map((f) => `[From ${f.source}]: ${f.text}`)
                                    .join('\n')}
                                        What has been learned? What gaps remain? What specific aspects should be investigated next if any?
                                        If you need to search for more information, include a nextSearchTopic.
                                        If you need to search for more information in a specific URL, include a urlToSearch.
                                        Important: Ensure the response is valid JSON. Do not include any characters outside of the JSON format.
                                        If less than 1 minute remains, set shouldContinue to false to allow time for final synthesis.
                                        If I have enough information, set shouldContinue to false.
                                        
                                        Respond in this exact JSON format:
                                        {
                                          "analysis": {
                                            "summary": "summary of findings",
                                            "gaps": ["gap1", "gap2"],
                                            "nextSteps": ["step1", "step2"],
                                            "shouldContinue": true/false,
                                            "nextSearchTopic": "optional topic",
                                            "urlToSearch": "optional url"
                                          }
                                        }`,
                                    });
                                    try {
                                        let jsonString = result.text.replace(/`/g, ''); //Remove backticks.
                                        jsonString = jsonString.replace(/^json\s*/i, ''); //Remove leading "json".
                                        jsonString = jsonString.trim(); //Remove whitespace.
                            
                                        if (!jsonString) {
                                            console.error("OpenAI response was empty.");
                                            return null;
                                        }
                            
                                        const parsed = JSON.parse(jsonString);
                                        return parsed.analysis;
                                      } catch (error) {
                                        console.error('Failed to parse JSON response:', error);
                                        return null;
                                      }

                                } catch (error) {
                                    console.error('Analysis failed:', error);
                                    return null;
                                }
                            };

                            console.debug(`[Research Step mehdiiiiiii] Extracting from URLs: ${JSON.stringify(topUrls)}`);

                            const newFindings = await extractFromUrls([
                                researchState.urlToSearch,
                                ...topUrls,
                              ]);

                            researchState.findings.push(...newFindings);

                            // Analysis phase
                            const analysis = await analyzeAndPlan(researchState.findings);
                            researchState.nextSearchTopic =
                            analysis?.nextSearchTopic || '';
                            researchState.urlToSearch = analysis?.urlToSearch || '';
                            researchState.summaries.push(analysis?.summary || '');

                            console.log(analysis);

                            if (!analysis) {
                                researchState.failedAttempts++;
                                if (
                                  researchState.failedAttempts >=
                                  researchState.maxFailedAttempts
                                ) {
                                  break;
                                }
                                continue;
                            }
                            if (!analysis.shouldContinue || analysis.gaps.length === 0) {
                                break;
                              }
                            topic = analysis.gaps.shift() || topic;

                        }
                        // some loggings for debuggings

                        console.log("Research State Findings:");
                        if (researchState.findings.length === 0) {
                            console.log("  - Findings array is empty.");
                        } else {
                            researchState.findings.forEach((finding, index) => {
                                console.log(`  - Finding ${index + 1}:`);
                                console.log(`    Source: ${finding.source}`);
                                console.log(`    Text: ${finding.text}`);
                            });
                        }
                
                        console.log("Research State Summaries:");
                        if (researchState.summaries.length === 0) {
                            console.log("  - Summaries array is empty.");
                        } else {
                            researchState.summaries.forEach((summary, index) => {
                                console.log(`  - Summary ${index + 1}:`);
                                console.log(`    Text: ${summary}`);
                            });
                        }

                        // Final synthesis
                        console.debug("final analysis ")
                        const finalAnalysis = await generateText({
                            model: openai("gpt-4o"),
                            maxTokens: 8192,
                            prompt: `Create a comprehensive long analysis of ${topic} based on these findings:
                            ${researchState.findings
                        .map((f) => `[From ${f.source}]: ${f.text}`)
                        .join('\n')}
                            ${researchState.summaries
                              .map((s) => `[Summary]: ${s}`)
                              .join('\n')}
                            Provide all the thoughts processes including findings details,key insights, conclusions, and any remaining uncertainties. Include citations to sources where appropriate. This analysis should be very comprehensive and full of details. It is expected to be very long, detailed and comprehensive.`,

                        });

                        // console.log("Final Analysis OpenAI Response:", finalAnalysis.text); // Add this line

                        return finalAnalysis.text;

                        // return {
                        //     success: true,
                        //     data: {
                        //       findings: researchState.findings,
                        //       analysis: finalAnalysis.text,
                        //       completedSteps: researchState.completedSteps,
                        //       totalSteps: researchState.totalExpectedSteps,
                        //     },
                        //   };
                        // return { researchState };
                    } catch (error: any) {
                        console.error('Deep Research failed:', error);
                        throw error;
                    }
                }
            }
        },
        maxSteps: 2,
    });
}

if (require.main === module) {
    (async () => {
        try {
            const result = await agent("what is the cause of insomnia");
            // console.log(result);
            console.log(result.text);
        } catch (error) {
            console.error("Error running agent:", error);
        }
    })();
}

